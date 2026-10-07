#!/usr/bin/env node
'use strict';
/* Oracle for synthetic_vision lesson 06 (the rare case).
 *
 * Re-derives every number the lesson quotes, with code that does not share a code path with the page or the builder:
 *   - how often the street draws case R (a pedestrian steps out from behind the van closer than 12 m): 10^6 scene draws AND the exact integral of the scene law
 *     (this reads SV.REAL.scene: a LAB PRIVILEGE, the lesson itself only says "the program counts its own frequencies");
 *   - the conditional sampler of R: rejection on top of the forced composition gives the street's law given R (means and Kolmogorov-Smirnov distances against the R scenes found by brute force among the 10^6 draws),
 *     and the cost of the rejection (draws per kept scene);
 *   - the importance identity and the weights p/q, (1-p)/(1-q): Monte Carlo (the weighted mean over a q-mixture equals the natural mean; the unweighted one is off by the predicted amount), with a scene function and with the detector's alarm;
 *   - the effective sample size: closed form vs the sample formula vs the variance of a weighted mean by simulation; the two-stratum design;
 *   - the odds the learner sees: c(q) = q(1-p)/(p(1-q)) by counting pedestrian frames in a plan;
 *   - Neyman allocation: the closed form against a numerical minimiser, and the variance formula against simulation;
 *   - the tables of l06_data.js: the natural cell against tables.js, two cells recomputed from scratch with this file's own training-set construction and exam, the rule-sliced counts of the R slice recomputed from frames this file draws itself;
 *   - the widget, driven through the states the prose names.
 * Last stdout line: {"facts": {...}}. */
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '../../../all_lessons');
const dir = fs.existsSync(path.join(root, 'synthetic_vision_new')) ? 'synthetic_vision_new' : 'synthetic_vision';
const SV = require(path.join(root, dir, 'street.js'));
require(path.join(root, dir, 'tables.js'));
try { require(path.join(root, dir, 'l06_data.js')); } catch (e) { /* the builder has not run yet */ }
const T = SV.TABLES, D = SV.L06;
const { loadPage } = require('../dom_probe.js');
const T0 = Date.now();

let bad = 0;
const fail = (m) => { bad++; console.error('FAIL ' + m); };
const check = (c, m) => { if (!c) fail(m); };
const F = {};
const put = (k, v, d) => { F[k] = +(+v).toFixed(d === undefined ? 6 : d); };
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const pc = (x) => 100 * x;
const sd = (a) => { const m = mean(a); return Math.sqrt(mean(a.map((x) => (x - m) ** 2))); };
const CFG = SV.REAL.scene;                       // LAB PRIVILEGE: the street's own scene law, read only here, to check the program's counts against an exact integral
const ZR = 12;

/* ───────────── 1 · how often does the street draw case R? ───────────── */
/* exact: P(R) = P(pedestrian) P(van) P(step-out | van) P(z_van + hz_van + U(0.8, 9) < 12), by midpoint quadrature over the two van variables */
function exactPR() {
  const v = CFG.van, K = 3000; let acc = 0;
  for (let i = 0; i < K; i++) {
    const z = v.z[0] + (i + 0.5) / K * (v.z[1] - v.z[0]);
    for (let j = 0; j < K; j++) {
      const hz = v.hz[0] + (j + 0.5) / K * (v.hz[1] - v.hz[0]), u = (ZR - z - hz - 0.8) / (9 - 0.8);
      acc += u <= 0 ? 0 : u >= 1 ? 1 : u;
    }
  }
  return CFG.pPed * CFG.pVan * CFG.pEmerge * acc / (K * K);
}
const pExact = exactPR();
const NDRAW = 1000000, S0 = 20000000;
let nR = 0, nPed = 0, nEm = 0; const refR = [];
for (let i = 0; i < NDRAW; i++) {
  const sc = SV.drawScene(CFG, SV.stream(S0 + i, 'scene'));
  if (!sc.ped) continue;
  nPed++;
  if (sc.mode === 'emerge') { nEm++; if (sc.ped.parts[0].z < ZR) { nR++; refR.push({ z: sc.ped.parts[0].z, vz: sc.van.parts[0].z, vhz: sc.van.parts[0].hz, r: sc.ped.parts[0].r * 1 / 0.85, x: sc.ped.parts[0].x }); } }
}
const pSim = nR / NDRAW, seP = Math.sqrt(pSim * (1 - pSim) / NDRAW);
check(Math.abs(pSim - pExact) < 4 * seP, 'case R: 10^6 draws give ' + pSim + ', the exact integral ' + pExact.toFixed(6) + ' (4 s.e. = ' + (4 * seP).toExponential(1) + ')');
put('p_pct', pc(pExact), 3); put('one_in', 1 / pExact, 0); put('per1600', 1600 * pExact, 1);
put('n_draws', NDRAW, 0); put('n_R_draws', nR, 0);
const SVL = require(path.join(root, dir, 'l06_rare.js'));
check(Math.abs(SVL.P_R - pExact) < 2e-5, 'the engine\'s constant p = ' + SVL.P_R + ' agrees with the exact integral ' + pExact.toFixed(6));
put('p_engine_pct', pc(SVL.P_R), 3);
put('stepout_pct', pc(nEm / nPed), 0);                                    // the lesson 1 number: 28% of the pedestrians step out
put('emerge_given_ped_R', pc(nR / nEm), 1);                              // share of step-outs that are close
put('accept_pct', pc(pExact / (CFG.pPed * CFG.pVan * CFG.pEmerge)), 1);  // the rejection sampler keeps this share of forced step-out scenes
put('tries', (CFG.pPed * CFG.pVan * CFG.pEmerge) / pExact, 1);

/* ───────────── 2 · the conditional sampler draws the street's law given R ───────────── */
{
  const mine = [], tries = [];
  for (let i = 0; i < 8000; i++) {
    const rng = SV.stream(21000000 + i, 'scene'); let sc, t = 0;
    for (;;) { t++; sc = SV.drawScene(CFG, rng, { ped: true, mode: 'emerge' }); if (sc.ped.parts[0].z < ZR) break; }
    tries.push(t); mine.push({ z: sc.ped.parts[0].z, vz: sc.van.parts[0].z, vhz: sc.van.parts[0].hz, r: sc.ped.parts[0].r / 0.85, x: sc.ped.parts[0].x });
  }
  const ks = (a, b) => { const s = a.slice().sort((x, y) => x - y), t = b.slice().sort((x, y) => x - y); let i = 0, j = 0, d = 0; while (i < s.length && j < t.length) { if (s[i] <= t[j]) i++; else j++; d = Math.max(d, Math.abs(i / s.length - j / t.length)); } return d; };
  const crit = 1.95 * Math.sqrt((mine.length + refR.length) / (mine.length * refR.length));      // 0.1% level
  let ksMax = 0;
  for (const k of ['z', 'vz', 'vhz', 'r', 'x']) {
    const d = ks(mine.map((o) => o[k]), refR.map((o) => o[k])); ksMax = Math.max(ksMax, d);
    check(d < crit, 'the sampler of R and the natural R scenes agree on ' + k + ' (KS ' + d.toFixed(4) + ' < ' + crit.toFixed(4) + ')');
  }
  put('ks_max', ksMax, 3); put('ks_crit', crit, 3);
  put('tries_measured', mean(tries), 1);
  check(Math.abs(mean(tries) - F.tries) < 0.5, 'draws per kept R scene: measured ' + mean(tries).toFixed(2) + ', predicted ' + F.tries);
  put('ped_z_mean_R', mean(mine.map((o) => o.z)), 1);
}

/* ───────────── 3 · weights, the importance identity, the effective sample size ───────────── */
const L = SVL;
const ess = (w) => { let s = 0, s2 = 0; for (const x of w) { s += x; s2 += x * x; } return s * s / s2; };
const p = L.P_R, pipe = L.program();
for (const q of [0.02, 0.05, 0.1, 0.25, 0.5]) {
  const pl = L.plan(pipe, 1600, q, SV.SEEDS.train + 100000, { seedR: 16200000 });
  const nRq = pl.items.filter((it) => it.isR).length, wR = pl.weights[pl.weights.length - 1], wO = pl.weights[0];
  check(nRq === Math.round(q * 1600), 'plan q=' + q + ' holds round(qN) R frames');
  check(Math.abs(wR - p / q) < 1e-12 && Math.abs(wO - (1 - p) / (1 - q)) < 1e-12, 'weights are p/q and (1-p)/(1-q)');
  check(Math.abs(pl.weights.reduce((a, b) => a + b, 0) - 1600) < 1e-9, 'the weights of a plan add up to N');
  const closed = 1 / (p * p / q + (1 - p) * (1 - p) / (1 - q));
  check(Math.abs(ess(pl.weights) / 1600 - closed) < 2e-3, 'ESS of the plan (' + (ess(pl.weights) / 1600).toFixed(4) + ') = the closed form (' + closed.toFixed(4) + ')');
  const t = 'q' + String(Math.round(q * 100)).padStart(2, '0');
  put('essfrac_' + t, closed, 3); put('ess_' + t, 1600 * closed, 0); put('c_' + t, q * (1 - p) / (p * (1 - q)), 1); put('k_' + t, q / p, 1);
  put('wR_' + t, p / q, 4); put('wO_' + t, (1 - p) / (1 - q), 3);
  check(Math.abs(closed - (1 - q)) < 0.03, 'ESS/N is about 1 - q (' + closed.toFixed(3) + ' vs ' + (1 - q) + ')');
  // what the learner sees: the odds that a pedestrian frame is a close step-out, counted in the plan
  const ped = pl.items.filter((it) => it.ped).length, oddsQ = nRq / (ped - nRq), nat = L.plan(pipe, 1600 * 40, null, SV.SEEDS.train + 300000), pedN = nat.items.filter((it) => it.ped).length, nRn = nat.nR;
  const oddsN = nRn / (pedN - nRn);
  if (q === 0.25 || q === 0.1) { put('odds_ratio_' + t, oddsQ / oddsN, 0); check(Math.abs(oddsQ / oddsN / F['c_' + t] - 1) < 0.1, 'the odds that a pedestrian is a close step-out are c(q) = ' + F['c_' + t] + ' times higher (counted ' + (oddsQ / oddsN).toFixed(1) + ')'); }
  if (q === 0.25) { put('ped_share_R_nat', pc(nRn / pedN), 2); put('ped_share_R_q25', pc(nRq / ped), 0); put('ped_frames_q25', ped, 0); }
}
/* the ESS is the size of an unweighted sample with the same variance of the mean: simulation with iid unit-variance f */
{
  const pl = L.plan(pipe, 1600, 0.25, SV.SEEDS.train + 100000, { seedR: 16200000 }), w = pl.weights, sw = w.reduce((a, b) => a + b, 0), rng = SV.rng(77);
  const ms = []; for (let r = 0; r < 20000; r++) { let s = 0; for (let i = 0; i < w.length; i++) s += w[i] * SV.randn(rng); ms.push(s / sw); }
  const v = mean(ms.map((x) => x * x)), e = ess(w);
  check(Math.abs(1 / v / e - 1) < 0.04, 'variance of the weighted mean is 1/ESS (simulated ESS ' + (1 / v).toFixed(0) + ' vs ' + e.toFixed(0) + ')');
  put('ess_check_ratio', 1 / v / e, 2);
}
/* Monte Carlo: the weighted mean over a q-mixture equals the natural mean; the unweighted one does not */
{
  const q = 0.25, N = 200000, pl = L.plan(pipe, N, q, 5000000, { seedR: 16400000 }), w = pl.weights;
  const fPed = pl.items.map((it) => (it.ped ? 1 : 0)), nat = L.plan(pipe, N, null, 7000000), natPed = mean(nat.items.map((it) => (it.ped ? 1 : 0)));
  const unw = mean(fPed), wtd = fPed.reduce((a, f, i) => a + w[i] * f, 0) / pl.weights.reduce((a, b) => a + b, 0);
  const predictedUnw = q * 1 + (1 - q) * (natPed - p) / (1 - p);                    // the pedestrian share of the q-mixture: R frames all hold one
  check(Math.abs(wtd - natPed) < 0.004 && Math.abs(unw - predictedUnw) < 0.004 && unw - natPed > 0.1, 'pedestrian share: natural ' + natPed.toFixed(4) + ', weighted mixture ' + wtd.toFixed(4) + ', unweighted ' + unw.toFixed(4) + ' (predicted ' + predictedUnw.toFixed(4) + ')');
  put('mc_ped_nat', pc(natPed), 1); put('mc_ped_unw', pc(unw), 1); put('mc_ped_wtd', pc(wtd), 1);
  const nE = pl.items.length; let fR = 0, wR = 0; pl.items.forEach((it, i) => { if (it.isR) { fR++; wR += w[i]; } });
  check(Math.abs(wR / nE - p) < 1e-9, 'the weighted share of R frames is p (' + (wR / nE).toFixed(6) + ')');
  put('mc_R_unw', pc(fR / nE), 1); put('mc_R_wtd', pc(wR / nE), 3);
}

/* ───────────── 4 · Neyman allocation: closed form against a minimiser, formula against simulation ───────────── */
function minimise(f, lo, hi) { const g = (Math.sqrt(5) - 1) / 2; let a = lo, b = hi; for (let i = 0; i < 200; i++) { const c = b - g * (b - a), d = a + g * (b - a); if (f(c) < f(d)) b = d; else a = c; } return (a + b) / 2; }
{
  const sigR = 0.5, sigO = 0.4, pp = 0.00815, N = 1600;
  for (const c of [1, 10, 100]) {
    const qStar = minimise((q) => Math.pow(pp * c * sigR, 2) / (q * N) + Math.pow((1 - pp) * sigO, 2) / ((1 - q) * N), 1e-6, 1 - 1e-6), closed = L.neymanShare(pp, c, sigR, sigO);
    check(Math.abs(qStar - closed) < 1e-6, 'Neyman share for c = ' + c + ': minimiser ' + qStar.toFixed(6) + ' vs closed form ' + closed.toFixed(6));
  }
  // the variance formula, by simulation: Bernoulli losses with means m_s, estimator sum_s p_s c_s mean_s
  const rng = SV.rng(99), mR = 0.5, mO = 0.2, c = 10, q = 0.1, nR = Math.round(q * N), nO = N - nR; let acc = 0, acc2 = 0; const reps = 6000;
  for (let r = 0; r < reps; r++) {
    let a = 0, b = 0; for (let i = 0; i < nR; i++) a += rng() < mR ? 1 : 0; for (let i = 0; i < nO; i++) b += rng() < mO ? 1 : 0;
    const est = pp * c * a / nR + (1 - pp) * b / nO; acc += est; acc2 += est * est;
  }
  const varSim = acc2 / reps - Math.pow(acc / reps, 2), varF = Math.pow(pp * c, 2) * mR * (1 - mR) / nR + Math.pow(1 - pp, 2) * mO * (1 - mO) / nO;
  check(Math.abs(varSim / varF - 1) < 0.06, 'variance of the stratified estimator: simulated ' + varSim.toExponential(3) + ' vs formula ' + varF.toExponential(3));
}


/* ───────────── 5 · the street's frames, drawn here with this file's own loops ───────────── */
const r5 = (x) => +Number(x).toPrecision(5);
const PIPE = SV.hybrid(SV.SIM0, SV.REAL, { scene: 'b', look: 'b', sensor: 'b', label: 'a' });           // the exact-stage program bbba
function ownRender(pipe, seed, scene) {
  const look = SV.drawLook(pipe.look, scene, SV.stream(seed, 'look')), ren = SV.render(scene, look), x = SV.sense(ren.rad, pipe.sensor, SV.stream(seed, 'sensor')), lab = SV.labels(ren.cov, pipe.label, scene, look);
  return { x: x, cov: ren.cov, y: lab.present, area: lab.area, full: lab.full, mode: scene.mode, z: scene.ped ? scene.ped.parts[0].z : 0 };
}
const closeR = (sc) => !!(sc.ped && sc.mode === 'emerge' && sc.ped.parts[0].z < ZR);
function ownStratum(pipe, seed, kind) {                                    // 'R', 'open' (closer than 12 m): rejection on the forced composition; 'nat': natural
  const rs = SV.stream(seed, 'scene'); let sc;
  for (;;) {
    sc = kind === 'nat' ? SV.drawScene(pipe.scene, rs) : SV.drawScene(pipe.scene, rs, { ped: true, mode: kind === 'R' ? 'emerge' : 'open' });
    if (kind === 'nat' || sc.ped.parts[0].z < ZR) break;
  }
  return ownRender(pipe, seed, sc);
}
const REALP = SV.REAL;
const mk = (n, seed0, kind, pipe) => { const out = []; for (let i = 0; i < n; i++) out.push(ownStratum(pipe || REALP, seed0 + i, kind)); out.forEach((f) => { delete f.cov; }); return out; };
const TEST = mk(3000, SV.SEEDS.test, 'nat'), VAL = mk(1500, SV.SEEDS.val, 'nat');
TEST.forEach((f, i) => { f.isR = closeR(SV.drawScene(REALP.scene, SV.stream(SV.SEEDS.test + i, 'scene'))); });
const RSL = mk(D ? D.sets.R.n : 3000, 16500000, 'R'), OSL = mk(D ? D.sets.open.n : 3000, 16600000, 'open');
const counts = (set, rule) => set.filter((f) => (rule === 'pixel' ? f.area >= 1 : rule === 'exam' ? f.y && f.area >= 6 : rule === 'frac15' ? !!f.y : f.area >= 0.5 * f.full)).length;
put('n_exam', TEST.filter((f) => f.y && f.area >= 6).length, 0);
put('test_R_n', TEST.filter((f) => f.isR && f.y && f.area >= 6).length, 0);
check(F.test_R_n === D.arms.nat.testRn[0], 'the real test set holds ' + F.test_R_n + ' close step-outs that count (the data file says ' + D.arms.nat.testRn[0] + ')');
for (const r of ['pixel', 'exam', 'frac15', 'half']) check(counts(RSL, r) === D.sets.R.counts[r], 'R slice, rule ' + r + ': ' + counts(RSL, r) + ' frames count, the data file says ' + D.sets.R.counts[r]);
check(counts(OSL, 'exam') === D.sets.open.counts.exam, 'open slice: the exam counts ' + counts(OSL, 'exam') + ' frames');
put('n_R_slice', counts(RSL, 'exam'), 0); put('n_open_slice', counts(OSL, 'exam'), 0);
for (const r of ['pixel', 'exam', 'frac15', 'half']) put('cnt_' + r, 100 * counts(RSL, r) / RSL.length, 1);
put('exam_frac', 100 * counts(RSL, 'exam') / RSL.length, 0);
put('exam_one_in', 1 / (pExact * counts(RSL, 'exam') / RSL.length), 0); put('exam_per1600', 1600 * pExact * counts(RSL, 'exam') / RSL.length, 1);
{ const sl = RSL.filter((f) => f.area >= 1 && f.area < 6).length; put('sliver_pct', 100 * sl / RSL.filter((f) => f.area >= 1).length, 0); }
{ const a = RSL.map((f) => f.area / f.full).sort((x, y) => x - y); put('frac_median', 100 * a[a.length >> 1], 0); }

/* ───────────── 6 · the data file: seed means, the seam to tables.js, the arithmetic of the prose ───────────── */
const A = D.arms, am = (id, f) => mean(A[id][f]), ar = (id, r) => mean(A[id].R[r]);
for (let s = 0; s < 3; s++) {
  const t = T.swap.bbba;
  check(A.nat.exam[s] === t.realMiss[s] && A.nat.open[s] === t.missOpen[s] && A.nat.emerge[s] === t.missEmerge[s] && A.nat.auc[s] === t.realAUC[s] && A.nat.thr[s] === t.thrReal[s], 'the natural arm, seed ' + (s + 1) + ', is the cell bbba of tables.js');
}
check(Math.abs(mean(A.nat.exam) - mean(T.swap.bbba.realMiss)) < 1e-12, 'the natural exam miss is the table\'s 46.8%');
for (const id of Object.keys(A)) {
  put('R_' + id, pc(ar(id, 'exam')), 1); put('Rp_' + id, pc(ar(id, 'pixel')), 1); put('Rh_' + id, pc(ar(id, 'half')), 1); put('Rf_' + id, pc(ar(id, 'frac15')), 1);
  put('ex_' + id, pc(am(id, 'exam')), 1); put('oc_' + id, pc(am(id, 'openClose')), 1); put('op_' + id, pc(am(id, 'open')), 1); put('em_' + id, pc(am(id, 'emerge')), 1);
  put('fa_' + id, pc(am(id, 'fa0')), 1); put('thr_' + id, am(id, 'thr'), 2); put('nR_' + id, am(id, 'nR'), 0); put('ess_' + id, am(id, 'ess'), 0);
}
put('ex_sd_nat', pc(sd(A.nat.exam)), 1);
put('ex_nat_n', 1323, 0);
/* the learning curve of the slice */
const curve = {}; for (const N of [400, 800, 1600, 3200, 6400, 11200]) curve[N] = N === 1600 ? { nR: A.nat.nR, R: A.nat.R.exam, exam: A.nat.exam, openClose: A.nat.openClose } : D.curve[N];
for (const N of Object.keys(curve)) { put('lc_nR_' + N, mean(curve[N].nR), 0); put('lc_R_' + N, pc(mean(curve[N].R || curve[N].exam)), 1); put('lc_ex_' + N, pc(mean(curve[N].exam)), 1); put('lc_oc_' + N, pc(mean(curve[N].openClose)), 1); }
put('lc_R_1600', pc(mean(A.nat.R.exam)), 1); put('lc_R_1600_seed1', pc(A.nat.R.exam[0]), 1);
put('lc_dR', pc(mean(A.nat.R.exam) - mean(D.curve[11200].R)), 1); put('lc_ratio_N', 11200 / 1600, 0); put('lc_ratio_R', mean(D.curve[11200].nR) / mean(A.nat.nR), 1);
check(Math.abs(F.lc_dR) < 3, 'the slice miss moves by ' + F.lc_dR + ' points between N = 1600 and 11200: flat');
/* the slice against the open pedestrians at the same distances */
check(pc(ar('nat', 'exam')) > 4 * pc(am('nat', 'openClose')), 'the rare case is missed several times as often as open pedestrians at the same distances');
put('ratio_R_open', ar('nat', 'exam') / am('nat', 'openClose'), 1);
/* what R is worth to the exam */
{
  const sR = pExact * counts(RSL, 'exam') / RSL.length / (F.n_exam / 3000);                   // share of R among the exam's pedestrians
  put('R_share_exam', pc(sR), 1); put('R_gain_pts', pc(sR * ar('nat', 'exam')), 1);
  check(sR * ar('nat', 'exam') < 0.012, 'a perfect detector of R would move the exam by less than 1.2 points');
}
/* frames needed by waiting, and by under-sampling */
put('wait_N_80', 80 / pExact, 0); put('wait_x_80', 80 / pExact / 1600, 1); put('under_N_160', 160 / pExact, 0); put('under_x_160', 160 / pExact / 1600, 1);
put('brute_nR', mean(D.curve[11200].nR), 0);
/* the exchange rate: a weighted design is worth the natural program at N = ESS */
for (const q of [10, 25, 50]) {
  put('xr_ex_w' + q, pc(am('q' + q + 'w', 'exam')), 1); put('xr_ex_n' + q, pc(am('natESS' + q, 'exam')), 1); put('xr_R_w' + q, pc(ar('q' + q + 'w', 'exam')), 1); put('xr_R_n' + q, pc(ar('natESS' + q, 'exam')), 1);
  put('xr_N' + q, am('natESS' + q, 'ess'), 0);
  check(Math.abs(F['xr_ex_w' + q] - F['xr_ex_n' + q]) < 2.0, 'q = ' + q + '%: the weighted design (' + F['xr_ex_w' + q] + ') is worth the natural program at N = ESS (' + F['xr_ex_n' + q] + ') on the exam');
}
/* the weights choose the detector, the share chooses the variance */
for (const [a, b] of [['t50to25', 'q25u'], ['t10to25', 'q25u']]) {
  check(Math.abs(ar(a, 'exam') - ar(b, 'exam')) < 0.025 && Math.abs(am(a, 'exam') - am(b, 'exam')) < 0.025, a + ' and ' + b + ' give the same detector within 2.5 points');
}
put('t_ess', am('t50to25', 'ess'), 0); put('t_ess_frac', am('t50to25', 'ess') / 1600, 2);
check(Math.abs(am('t50to25', 'ess') - 1600 / (0.25 * 0.25 / 0.5 + 0.75 * 0.75 / 0.5)) < 1e-6 + 0.5, 'ESS of weights from q = 50% to a target of 25%: 1/(t²/q + (1-t)²/(1-q)) of N');
/* label shift only */
put('ped90_thr', am('ped90', 'thr') - am('nat', 'thr'), 2); put('ped10_thr', am('ped10', 'thr') - am('nat', 'thr'), 2);
put('ped90_ex', pc(am('ped90', 'exam') - am('nat', 'exam')), 1); put('ped10_ex', pc(am('ped10', 'exam') - am('nat', 'exam')), 1);
put('q25_ex', pc(am('q25u', 'exam') - am('nat', 'exam')), 1); put('q50_ex', pc(am('q50u', 'exam') - am('nat', 'exam')), 1); put('q10_ex', pc(am('q10u', 'exam') - am('nat', 'exam')), 1);
put('q25_thr', am('q25u', 'thr') - am('nat', 'thr'), 2); put('q50_thr', am('q50u', 'thr') - am('nat', 'thr'), 2);
for (const id of ['q02u', 'q05u', 'q10u', 'q25u', 'q50u']) { put('dR_' + id, pc(ar('nat', 'exam') - ar(id, 'exam')), 1); put('dOc_' + id, pc(am(id, 'openClose') - am('nat', 'openClose')), 1); }
for (const id of ['q10w', 'q25w', 'q50w']) put('dR_' + id, pc(ar('nat', 'exam') - ar(id, 'exam')), 1);
put('R_floor', Math.min(...['q10u', 'q25u', 'q50u'].map((id) => pc(ar(id, 'exam')))), 1);

/* ───────────── 7 · choosing the share and the weight: spreads from the lab, Neyman, the cost-weighted exam ───────────── */
{
  const sR = F.R_share_exam / 100, pExam = counts(RSL, 'exam') / RSL.length;                  // P(an R frame holds a pedestrian that counts)
  const muR = pExam * ar('nat', 'exam'), pOth = (F.n_exam / 3000 - pExact * pExam) / (1 - pExact), muO = pOth * (am('nat', 'exam') - sR * ar('nat', 'exam')) / (1 - sR);
  put('sigR', Math.sqrt(muR * (1 - muR)), 2); put('sigO', Math.sqrt(muO * (1 - muO)), 2); put('muR', muR, 2); put('muO', muO, 2);
  for (const c of [1, 10, 100]) { put('ney_c' + c, pc(L.neymanShare(pExact, c, F.sigR, F.sigO)), 1); put('tshare_c' + c, pc(c * pExact / (1 - pExact + c * pExact)), 1); }
  const cw = (id, c) => { const mR = ar(id, 'exam'), mN = (am(id, 'exam') - sR * mR) / (1 - sR); return ((1 - sR) * mN + c * sR * mR) / ((1 - sR) + c * sR); };
  for (const c of [1, 10, 100]) {
    const ids = ['nat', 'q10u', 'q25u', 'q50u'], v = ids.map((id) => pc(cw(id, c)));
    ids.forEach((id, i) => put('cw_' + id + '_c' + c, v[i], 1));
    put('cw_best_c' + c, ids.indexOf(ids[v.indexOf(Math.min(...v))]), 0);
  }
  put('c_q10_breakeven', (am('q10u', 'exam') - am('nat', 'exam')) * (1 - sR) / (sR * (ar('nat', 'exam') - ar('q10u', 'exam'))), 0);
}

/* ───────────── 8 · which pedestrians count in the rare slice ───────────── */
for (const id of ['nat', 'q10u']) for (const r of ['pixel', 'exam', 'half']) put('Rr_' + id + '_' + r, pc(ar(id, r)), 1);
put('rule_gap_pe', F.Rr_nat_pixel - F.Rr_nat_exam, 1); put('rule_gap_eh', F.Rr_nat_exam - F.Rr_nat_half, 1); put('rule_gap_ph', F.Rr_nat_pixel - F.Rr_nat_half, 1);
{
  const psy = (id) => { const a = A[id], n = D.sets.R.binN; return n.map((nb, b) => 1 - mean(a.psy.map((h) => h[b])) / nb); };
  const pn = psy('nat'), pq = psy('q10u'); pn.forEach((v, b) => { put('psy_nat_' + b, pc(v), 0); put('psy_q10_' + b, pc(pq[b]), 0); });
  // the rule is a cut on this curve: recompute the pixel-rule miss from the bins and compare with the data file
  const bn = D.sets.R.binN, tot = bn.reduce((a, b) => a + b, 0), fromBins = pn.reduce((a, v, b) => a + v * bn[b], 0) / tot;
  check(Math.abs(fromBins - ar('nat', 'pixel')) < 0.004, 'the pixel-rule miss is the count-weighted mean of the bins (' + fromBins.toFixed(4) + ' vs ' + ar('nat', 'pixel').toFixed(4) + ')');
  put('bin_share_lt15', 100 * (bn[0] + bn[1] + bn[2]) / tot, 0);
}

/* ───────────── 9 · the checkpoint, the logging error of p, the label-shift identity on a toy logistic fit ───────────── */
{
  const wc = 0.01 / 0.2, wo = 0.99 / 0.8, N2 = 2000, w = [], rng = SV.rng(5); for (let i = 0; i < N2; i++) w.push(i < 400 ? wc : wo);
  let s1 = 0, s2 = 0; for (const x of w) { s1 += x; s2 += x * x; }                           // brute-force sums, not the closed form
  put('ck_wc', wc, 3); put('ck_wo', wo, 4); put('ck_ess', s1 * s1 / s2, 0); put('ck_frac', s1 * s1 / s2 / N2, 3); put('ck_total', 400 * wc, 0); put('ck_c', 0.2 * 0.99 / (0.01 * 0.8), 2);
  check(Math.abs(s1 - N2) < 1e-9 && Math.abs(s1 * s1 / s2 / N2 - 1 / (0.0001 / 0.2 + 0.9801 / 0.8)) < 1e-9, 'checkpoint: weights add to N and the closed form of the effective sample size agrees');
  put('p_logged', 10000 * pExact, 0); put('p_err_10k', 100 / Math.sqrt(10000 * pExact), 0); put('other_pct', 100 * (1 - pExact), 1);
  put('R_weight_q25', 400 * pExact / 0.25, 0);
}
{ // label shift moves the intercept by the log of the ratio of prior odds and leaves the slope: a logistic fit by SV.fitHead on two Gaussian classes
  const rng = SV.rng(31), n = 60000, slopeOf = (pi) => {
    const F1 = new Float32Array(n), Y = new Uint8Array(n);
    for (let i = 0; i < n; i++) { const y = rng() < pi ? 1 : 0; Y[i] = y; F1[i] = SV.randn(rng) + 2 * y; }
    const m = SV.fitHead([{ F: F1, Y: Y, n: n, wt: 1 }], 1, { lam: 1e-9, iters: 30 });
    return { slope: m.w[0] / m.sd[0], icpt: m.w[1] - m.w[0] * m.mu[0] / m.sd[0] };
  };
  const a = slopeOf(0.5), b = slopeOf(0.9), shift = b.icpt - a.icpt, want = Math.log(0.9 / 0.1);
  check(Math.abs(shift - want) < 0.1 && Math.abs(a.slope - b.slope) < 0.1 && Math.abs(a.slope - 2) < 0.1, 'a label shift moves the intercept by the log of the prior odds ratio (' + shift.toFixed(2) + ' vs ' + want.toFixed(2) + ') and leaves the slope (' + a.slope.toFixed(2) + ', ' + b.slope.toFixed(2) + ')');
  put('toy_shift', shift, 2); put('toy_logodds', want, 2);
}
put('ped90_dR', pc(ar('ped90', 'exam') - ar('nat', 'exam')), 1); put('ped10_dR', pc(ar('ped10', 'exam') - ar('nat', 'exam')), 1);

/* ───────────── 10 · two cells of l06_data.js recomputed from scratch ───────────── */
function ownTrain(q, seed, weighted, target) {
  const s0 = SV.SEEDS.train + seed * 100000, seedR = 16100000 + seed * 100000, N = 1600, nRq = Math.round(q * N), frames = [], isRf = [];
  for (let s = s0; frames.length < N - nRq; s++) { if (closeR(SV.drawScene(PIPE.scene, SV.stream(s, 'scene')))) continue; frames.push(ownStratum(PIPE, s, 'nat')); isRf.push(false); }
  for (let i = 0; i < nRq; i++) { frames.push(ownStratum(PIPE, seedR + i, 'R')); isRf.push(true); }
  const t = target === undefined ? pExact : target, wR = t / q, wO = (1 - t) / (1 - q);
  return { frames: frames, weights: weighted ? isRf.map((r) => (r ? wR : wO)) : undefined };
}
function ownCell(q, seed, weighted, full) {
  const tr = ownTrain(q, seed, weighted, L.P_R), m0 = SV.train(tr.frames, { seed: seed, weights: tr.weights });
  const model = { dim: m0.dim, w: Array.from(m0.w, r5), mu: Array.from(m0.mu, r5), sd: Array.from(m0.sd, r5) };
  const score = (set) => set.map((f) => SV.score(model, f.x).s);
  const sT = score(TEST), sV = score(VAL), negV = sV.filter((_, i) => !VAL[i].y).sort((a, b) => a - b), thr = negV[Math.min(negV.length - 1, Math.floor(0.9 * negV.length))];
  let h = 0, n = 0; TEST.forEach((f, i) => { if (f.y && f.area >= 6) { n++; if (sT[i] > thr) h++; } });
  const out = { exam: 1 - h / n, thr: thr };
  if (full) {
    const sR = score(RSL), sO = score(OSL); let hr = 0, nr = 0, ho = 0, no = 0, hp = 0, np_ = 0;
    RSL.forEach((f, i) => { if (f.y && f.area >= 6) { nr++; if (sR[i] > thr) hr++; } if (f.area >= 1) { np_++; if (sR[i] > thr) hp++; } });
    OSL.forEach((f, i) => { if (f.y && f.area >= 6) { no++; if (sO[i] > thr) ho++; } });
    out.R = 1 - hr / nr; out.pixel = 1 - hp / np_; out.open = 1 - ho / no;
  }
  return out;
}
{
  const a = ownCell(0.1, 2, false, true), A10 = D.arms.q10u;
  check(Math.abs(a.exam - A10.exam[1]) < 1e-4 && Math.abs(a.R - A10.R.exam[1]) < 1e-4 && Math.abs(a.pixel - A10.R.pixel[1]) < 1e-4 && Math.abs(a.open - A10.openClose[1]) < 1e-4 && Math.abs(a.thr - A10.thr[1]) < 1e-3, 'q10u seed 2 from scratch: exam ' + a.exam.toFixed(4) + ' vs ' + A10.exam[1] + ', slice ' + a.R.toFixed(4) + ' vs ' + A10.R.exam[1]);
  const b = ownCell(0.25, 3, true, false), A25 = D.arms.q25w;
  check(Math.abs(b.exam - A25.exam[2]) < 1e-4 && Math.abs(b.thr - A25.thr[2]) < 1e-3, 'q25w seed 3 from scratch: exam ' + b.exam.toFixed(4) + ' vs ' + A25.exam[2]);
}

/* ───────────── 11 · the widget ───────────── */
{
  const page = loadPage(path.join(root, dir, '06_the_rare_case.html'), { dpr: 2, console: { log() {}, warn() {}, error() {} } });
  check(page.problems.length === 0, 'the page runs clean: ' + page.problems.slice(0, 2).join(' | '));
  const SHARE = [null, 0.02, 0.05, 0.1, 0.25, 0.5], KEY = ['nat', 'q02', 'q05', 'q10', 'q25', 'q50'];
  const pcs = (x) => (100 * x).toFixed(1) + '%';
  // the strips: one close step-out per bin of visible fraction (the first frame of the slice in that bin, found with this file's own binning) and the first eight open pedestrians
  const EDG = [0, 0.05, 0.1, 0.15, 0.25, 0.4, 0.6, 0.8, 1.0001], binOf = (f) => { const r = f.area / f.full; let b = 0; while (b + 1 < EDG.length - 1 && r >= EDG[b + 1]) b++; return b; };
  const RF = EDG.slice(0, 8).map((_, b) => RSL.find((f) => f.area >= 1 && binOf(f) === b)), OF = OSL.slice(0, 8);
  check(RF.length === 8 && RF.every(Boolean), 'the strip has a step-out in every bin of visible fraction');
  check(JSON.stringify(RF.map((f, b) => 16500000 + RSL.indexOf(f))) === JSON.stringify(D.sets.R.strip), 'the strip seeds in the data file are the first frame of each bin');
  const found = (id) => { const M = D.models[id], m = { dim: SV.DIM, w: M.w, mu: M.mu, sd: M.sd }; return [RF.filter((f) => SV.score(m, f.x).s > M.thr).length, OF.filter((f) => SV.score(m, f.x).s > M.thr).length]; };
  for (let k = 0; k < 6; k++) for (const wt of [false, true]) {
    if (k === 0 && wt) continue;
    const id = k === 0 ? 'nat' : KEY[k] + (wt ? 'w' : 'u'), a = D.arms[id];
    page.set('w06-q', k); page.check('w06-wt', wt); page.set('w06-rule', 'exam');
    const wts = (() => { if (k === 0) return null; const q = SHARE[k], n = Math.round(q * 1600), w = []; for (let i = 0; i < 1600 - n; i++) w.push((1 - L.P_R) / (1 - q)); for (let i = 0; i < n; i++) w.push(L.P_R / q); return w; })();
    check(page.text('w06-rs') === pcs(mean(a.R.exam)) && page.text('w06-ex') === pcs(mean(a.exam)) && page.text('w06-op') === pcs(mean(a.openClose)) && page.text('w06-fa') === pcs(mean(a.fa0)), 'widget k=' + k + ' wt=' + wt + ': slice, exam, open and alarm readouts ("' + [page.text('w06-rs'), page.text('w06-ex'), page.text('w06-op'), page.text('w06-fa')].join(' | ') + '")');
    if (k > 0) check(page.text('w06-nr') === String(Math.round(SHARE[k] * 1600)) && page.text('w06-ess') === String(Math.round(ess(wts))), 'widget k=' + k + ': R frames ' + page.text('w06-nr') + ', ESS ' + page.text('w06-ess'));
    const f = found(id); check(page.text('w06-fd') === f[0] + ' / 8 + ' + f[1] + ' / 8', 'widget k=' + k + ' wt=' + wt + ': found "' + page.text('w06-fd') + '" vs ' + f.join(' + '));
    put('fdr_' + id, f[0], 0); put('fdo_' + id, f[1], 0);
    if (k === 0) put('nr_nat_plan', +page.text('w06-nr'), 0);
  }
  page.set('w06-q', 0); page.check('w06-wt', false);
  for (const [rule, key] of [['pixel', 'pixel'], ['exam', 'exam'], ['half', 'half']]) { page.set('w06-rule', rule); check(page.text('w06-rs') === pcs(mean(D.arms.nat.R[key])), 'widget rule ' + rule + ': slice readout "' + page.text('w06-rs') + '"'); }
  check(page.problems.length === 0, 'the widget survives the states the prose names: ' + page.problems.slice(0, 2).join(' | '));
}


/* ───────────── 12 · facts and claims the prose adds ───────────── */
put('ex_range_nat', pc(Math.max(...A.nat.exam) - Math.min(...A.nat.exam)), 1);
put('q05_ex', pc(am('q05u', 'exam') - am('nat', 'exam')), 1);
put('ped_dR_max', Math.max(Math.abs(F.ped90_dR), Math.abs(F.ped10_dR)), 1);
F.wait_N_80 = Math.round(80 / pExact / 100) * 100; F.under_N_160 = Math.round(160 / pExact / 100) * 100;
check(Math.abs(F.q10_ex) < F.ex_range_nat, 'at a tenth of the renders the exam moves (' + F.q10_ex + ') by less than the seed range (' + F.ex_range_nat + ')');
check(F.R_q50u > F.R_q25u - 1.0 && F.q50_ex - F.q25_ex > 4, 'past a quarter of the renders the slice stops improving and the exam keeps paying');
check(['q10w', 'q25w', 'q50w'].every((id) => ar(id, 'exam') > ar('nat', 'exam') - 0.01), 'the weighted designs are no better than natural on the rare slice');
check(['q10', 'q25', 'q50'].every((q) => Math.abs(F['xr_R_w' + q.slice(1)] - F['xr_R_n' + q.slice(1)]) < 2.0), 'the weighted designs match the natural program at N = ESS on the slice too');
check(F.cw_best_c1 === 0 && F.cw_best_c100 === 2 && Math.abs(F.cw_q10u_c10 - F.cw_nat_c10) < 0.3, 'cost-weighted exam: natural wins at c = 1, the 25% design at c = 100, the 10% design breaks even with natural at c = 10');
check(F.rule_gap_ph > F.dR_q50u && F.rule_gap_pe > 0 && F.rule_gap_eh > 0, 'the rule moves the slice by more than any share of the renders');
check([0, 1, 2, 3].every((b) => F['psy_nat_' + b] >= 88) && F.psy_nat_5 < F.psy_nat_3 && F.psy_nat_7 < F.psy_nat_5, 'the miss rate by visible fraction: nine in ten below a quarter, then falling');
check(F.R_nat > 50 && F.oc_nat < 10 && F.R_nat > 5 * F.oc_nat, 'the natural detector misses most of the rare slice and about one open pedestrian in ten at the same distances');
check(Math.abs(F.ped90_thr) < 1 && Math.abs(F.ped10_thr) < 1.6 && Math.abs(F.ped90_ex) < 3 && Math.abs(F.ped10_ex) < 3 && F.ped_dR_max < 2, 'a pure label shift moves the threshold by about a logit, the exam by about two points, the slice by one');
check(F.t_ess === 1280 && Math.abs(F.ess_q50 - 813) < 1, 'ESS values quoted in the prose');

check(Date.now() - T0 < 200000, 'the oracle runs in under 200 s (' + Math.round((Date.now() - T0) / 1000) + ' s)');
if (bad) { console.error(bad + ' check(s) failed'); if (process.env.L06_FACTS) console.log(JSON.stringify({ facts: F })); process.exit(1); }
console.log(JSON.stringify({ facts: F }));
