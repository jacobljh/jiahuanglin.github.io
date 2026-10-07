#!/usr/bin/env node
'use strict';
/* Oracle for synthetic_vision lesson 10 (a little reality).
 *
 * Re-derives every number the lesson quotes with its own code (it never calls l10_reality.js to produce a fact; it loads it only to compare the page's engine with this file's arithmetic):
 *   - grading: Wilson and normal intervals by brute-force simulation (coverage at 11 and 100 pedestrians), the pedestrians and frames a half-width needs by a scan over n and by simulated binomial draws,
 *     the exam's own size (exam pedestrians per labelled frame counted on the real test set), the paired against the unpaired difference of two stored detectors by bootstrap over the same pedestrians,
 *     the threshold's error against the number of pedestrian-free frames on this file's own pool of frames (seed block 27,000,000), and the unlabelled logs as a source of the threshold;
 *   - the learning curves of the builder's data (l10_data.js): the means, the claims the prose makes about them (as checks with tolerances), the real-only curve refitted by Nelder-Mead (the page's engine
 *     grid-searches the exponent), the real-only sizes the curves equal, the split of a budget into training and grading frames by a scan over every integer split, the frames a target needs;
 *   - two trained cells recomputed from scratch with this file's own composition of the estimators of Lessons 3-5: real only at 100 frames (afternoon 2), calibrated at 50 frames (afternoon 1);
 *   - the exit's arithmetic: the stopping distance, the frames available by distance, p^k and p, and the pedestrian-level spread between them by Monte Carlo;
 *   - the widget, driven through the budgets the prose names against this file's own numbers (the live scene estimates through its own ruler calls).
 * Where it compares an estimate with the street's truth (SV.REAL) it says so: that is the lab's privilege.  Last stdout line: {"facts": {...}}. */
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '../../../all_lessons');
const dir = fs.existsSync(path.join(root, 'synthetic_vision_new')) ? 'synthetic_vision_new' : 'synthetic_vision';
const SV = require(path.join(root, dir, 'street.js'));
['evidence.js', 'tables.js', 'l03_camera.js', 'l03_data.js', 'l04_light.js', 'l04_data.js', 'l05_cases.js', 'l05_data.js', 'l10_reality.js', 'l10_data.js'].forEach((f) => require(path.join(root, dir, f)));
const T = SV.TABLES, D = SV.L10, L3 = SV.l03, L4 = SV.l04, L5 = SV.l05, E10 = SV.l10;
const { loadPage } = require('../dom_probe.js');

let bad = 0;
const fail = (m) => { bad++; console.error('FAIL ' + m); };
const check = (c, m) => { if (!c) fail(m); };
const near = (a, b, tol, m) => { if (!(Math.abs(a - b) <= tol)) fail(m + ': ' + a + ' vs ' + b + ' (tol ' + tol + ')'); };
const F = {};
const put = (k, v, d) => { F[k] = +(+v).toFixed(Math.max(4, d === undefined ? 6 : d)); };      // the page shows fewer digits (data-n); keep four so that it rounds the real value once
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const sd = (a) => { const m = mean(a); return Math.sqrt(mean(a.map((x) => (x - m) * (x - m)))); };
const quant = (a, p) => { const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const pc = (x) => 100 * x;
const Z = 1.959964;
const MS = D.protocol.M, GRID = [0].concat(MS), SEEDS = D.protocol.seeds;

/* ───────────── 1. the ledger: what the series' exam holds, in labelled frames ───────────── */
const test = SV.real.test(3000), val = SV.real.val(1500);
const exIdx = []; test.forEach((f, i) => { if (f.y && f.area >= 6) exIdx.push(i); });
const nEx = exIdx.length, ppf = nEx / test.length;
put('n_test', test.length, 0); put('n_val', val.length, 0); put('exam_frames', test.length + val.length, 0); put('n_exam', nEx, 0); put('ppf', ppf, 3); put('ppf_pct', pc(ppf), 1);
check(SV.EXAM.minArea === 6 && SV.EXAM.fa === 0.1 && T.protocol.realTest === 3000 && T.protocol.realVal === 1500, 'the exam: 3,000 test and 1,500 validation frames, 6 px^2, 10% false alarms');
near(D.grade.ppf, ppf, 1e-5, 'the builder\'s exam pedestrians per frame');
put('val_neg', val.filter((f) => !f.y).length, 0);
put('ledger_ratio', (test.length + val.length) / 200, 1);
const meanOf = (c) => mean(T.swap[c].realMiss);
put('m_naive', pc(meanOf('aaaa')), 1); put('m_exact', pc(meanOf('bbba')), 1); put('m_street', pc(meanOf('bbbb')), 1); put('m_abba', pc(meanOf('abba')), 1); put('m_aaba', pc(meanOf('aaba')), 1);
near(D.ref.naive, meanOf('aaaa'), 5e-5, 'reference line: naive'); near(D.ref.exact, meanOf('bbba'), 5e-5, 'reference line: exact stage');

/* ───────────── 2. grading: a miss rate is a binomial proportion ───────────── */
function wilson(k, n) { const p = k / n, z2 = Z * Z, d = 1 + z2 / n, c = (p + z2 / (2 * n)) / d, h = Z * Math.sqrt(p * (1 - p) / n + z2 / (4 * n * n)) / d; return [c - h, c + h]; }
function coverage(n, p, B, seed) {
  const rng = SV.rng(seed); let cw = 0, cd = 0;
  for (let b = 0; b < B; b++) {
    let k = 0; for (let i = 0; i < n; i++) if (rng() < p) k++;
    const w = wilson(k, n), ph = k / n, h = Z * Math.sqrt(ph * (1 - ph) / n);
    if (w[0] <= p && p <= w[1]) cw++;
    if (ph - h <= p && p <= ph + h) cd++;
  }
  return { wilson: cw / B, wald: cd / B };
}
for (const n of [11, 100]) { const c = coverage(n, 0.47, 20000, 5 + n); put('cov_wilson_' + n, pc(c.wilson), 1); put('cov_wald_' + n, pc(c.wald), 1); check(c.wilson > 0.94 && c.wilson < 0.97, 'the Wilson interval covers about 95% at ' + n + ' pedestrians (' + c.wilson + ')'); }
check(F.cov_wilson_11 > F.cov_wald_11, 'the Wilson interval covers better than the normal one at 11 pedestrians');
{ const w0 = wilson(0, 20); put('w0_hi', pc(w0[1]), 1); check(w0[0] === 0 || w0[0] < 1e-12, '0 misses in 20: the Wilson interval starts at 0 and does not collapse'); }
/* pedestrians for a half-width h: a scan over n (the page uses the closed form), and the spread of simulated binomial draws at that n */
const need = {}, needScan = (p, h) => { for (let n = 1; n < 400000; n++) if (Z * Math.sqrt(p * (1 - p) / n) <= h) return n; return Infinity; };
for (const p of [0.47, 0.8]) for (const h of [5, 3, 2, 1]) {
  const n = needScan(p, h / 100), closed = Z * Z * p * (1 - p) / ((h / 100) * (h / 100)), key = (p === 0.47 ? '47_' : '80_') + h;
  check(n === Math.ceil(closed - 1e-9) || n === Math.ceil(closed) + 0, 'scan and closed form agree for p = ' + p + ', h = ' + h + ': ' + n + ' vs ' + closed);
  need[key] = n;
  put('pd_' + key, n, 0); put('fr_' + key, Math.ceil(n / ppf), 0);
}
{ const rng = SV.rng(77), n = need['47_3'], v = []; for (let b = 0; b < 4000; b++) { let k = 0; for (let i = 0; i < n; i++) if (rng() < 0.47) k++; v.push(k / n); }
  const hw = (quant(v, 0.975) - quant(v, 0.025)) / 2; put('sim_hw_47_3', pc(hw), 2); near(hw, 0.03, 0.0025, 'simulated binomial draws at the pedestrians for +-3 points have a 95% half-width of 3 points'); }
put('hw_exam', pc(Z * Math.sqrt(0.47 * 0.53 / nEx)), 1); put('hw_exam_80', pc(Z * Math.sqrt(0.8 * 0.2 / nEx)), 1);
put('wilson_25_lo', pc(wilson(Math.round(0.54 * 11), 11)[0]), 0); put('wilson_25_hi', pc(wilson(Math.round(0.54 * 11), 11)[1]), 0);

/* the same frames: two detectors graded on the same pedestrians (stored models of the series' table; the thresholds are the table's) */
const mod = (k) => ({ dim: 110, w: T.models[k].w, mu: T.models[k].mu, sd: T.models[k].sd });
const hits = {};
['swap@aaba', 'swap@abba', 'swap@bbba'].forEach((k) => { const m = mod(k), thr = T.models[k].thrReal; hits[k] = exIdx.map((i) => (SV.score(m, test[i].x).s > thr ? 1 : 0)); });
{
  const ha = hits['swap@aaba'], hb = hits['swap@abba'], n = ha.length, pa = 1 - mean(ha), pb = 1 - mean(hb);
  let b = 0, c = 0; for (let i = 0; i < n; i++) { if (ha[i] && !hb[i]) b++; if (!ha[i] && hb[i]) c++; }
  const sdP = Math.sqrt((b + c) / (n * n) - Math.pow(b - c, 2) / (n * n * n)), sdU = Math.sqrt(pa * (1 - pa) / n + pb * (1 - pb) / n);
  /* bootstrap over the pedestrians: paired = the same resample for both detectors; unpaired = two independent resamples */
  const rng = SV.rng(31), dp = [], du = [];
  for (let r = 0; r < 1500; r++) {
    let ka = 0, kb = 0, ka2 = 0, kb2 = 0;
    for (let i = 0; i < n; i++) { const j = Math.floor(rng() * n); ka += ha[j]; kb += hb[j]; ka2 += ha[Math.floor(rng() * n)]; kb2 += hb[Math.floor(rng() * n)]; }
    dp.push((kb - ka) / n); du.push((kb2 - ka2) / n);
  }
  put('d_pair', pc(pa - pb), 1); put('sd_paired', pc(sdP), 2); put('sd_unpaired', pc(sdU), 2); put('z_paired', (pa - pb) / sdP, 1); put('z_unpaired', (pa - pb) / sdU, 1);
  put('var_ratio', (sdU * sdU) / (sdP * sdP), 1); put('disc_frac', pc((b + c) / n), 1); put('boot_sd_paired', pc(sd(dp)), 2); put('boot_sd_unpaired', pc(sd(du)), 2);
  near(sd(dp), sdP, 0.08 * sdP, 'bootstrap sd of the paired difference'); near(sd(du), sdU, 0.08 * sdU, 'bootstrap sd of the unpaired difference');
  { const ma = mean(ha), mb = mean(hb); let sxy = 0, va = 0, vb = 0; for (let i = 0; i < n; i++) { sxy += (ha[i] - ma) * (hb[i] - mb); va += (ha[i] - ma) ** 2; vb += (hb[i] - mb) ** 2; } put('rho_pair', sxy / Math.sqrt(va * vb), 2); }
  const d3 = 0.03, perPaired = (b + c) / n - d3 * d3, perUnp = pa * (1 - pa) + pb * (1 - pb);
  put('n3_paired', Z * Z * perPaired / (d3 * d3), 0); put('n3_unpaired', Z * Z * perUnp / (d3 * d3), 0);
  put('fr3_paired', Math.ceil(F.n3_paired / ppf), 0); put('fr3_unpaired', Math.ceil(F.n3_unpaired / ppf), 0);
  check(F.var_ratio > 1.8 && F.var_ratio < 3.2, 'pairing removes more than half of the variance of the difference (' + F.var_ratio + ')');
}

/* ───────────── 3. the threshold is a measurement too ───────────── */
{
  const key = 'swap@bbba', m = mod(key), thrVal = T.models[key].thrReal;
  const exScore = exIdx.map((i) => SV.score(m, test[i].x).s), missAt = (thr) => 1 - exScore.filter((s) => s > thr).length / exScore.length;
  const pool = []; for (let i = 0; i < 4000; i++) pool.push(SV.score(m, SV.sample(SV.REAL, 27000000 + i, { ped: false }).x).s);
  const faAt = (thr) => pool.filter((v) => v > thr).length / pool.length, sorted = pool.slice().sort((a, b) => a - b);
  const thrAt = (fa) => sorted[Math.min(sorted.length - 1, Math.floor((1 - fa) * sorted.length))];
  /* miss rate against the false-alarm rate at the exam's operating point: the slope that turns an error of the threshold into an error of the miss rate */
  const m5 = missAt(thrAt(0.05)), m10 = missAt(thrAt(0.10)), m15 = missAt(thrAt(0.15));
  put('miss_fa5', pc(m5), 1); put('miss_fa10', pc(m10), 1); put('miss_fa15', pc(m15), 1); put('slope', (m5 - m15) / 0.10, 2);
  const rng = SV.rng(2025);
  for (const M0 of [50, 150, 500, 1500]) {
    const ms = [], fs_ = [];
    for (let r = 0; r < 500; r++) { const s = []; for (let i = 0; i < M0; i++) s.push(pool[Math.floor(rng() * pool.length)]); s.sort((a, b) => a - b); const t = s[Math.min(M0 - 1, Math.floor(0.9 * M0))]; ms.push(missAt(t)); fs_.push(faAt(t)); }
    put('thr_sd_fa_' + M0, pc(sd(fs_)), 1); put('thr_sd_miss_' + M0, pc(sd(ms)), 1);
    const g = D.grade.draws.find((d) => d.M0 === M0);
    near(sd(ms), g.sdMiss, 0.25 * g.sdMiss + 0.004, 'the builder\'s sd of the miss rate at M0 = ' + M0 + ' (own pool)');
    near(sd(fs_), Math.sqrt(0.09 / M0), 0.2 * Math.sqrt(0.09 / M0) + 0.002, 'the sd of the false-alarm rate is the binomial one, sqrt(0.09 / M0), at M0 = ' + M0);
  }
  put('thr_sd_val', F.slope * Math.sqrt(0.09 / F_val()) * 100, 1);
  function F_val() { return val.filter((f) => !f.y).length; }
  put('val_fa_err', pc(Math.sqrt(0.09 / F_val())), 1);
  put('fa_at_val_thr', pc(faAt(thrVal)), 1); put('miss_at_val_thr', pc(missAt(thrVal)), 1); put('thr_flatter', pc(m10 - missAt(thrVal)), 1);
  /* the unlabelled logs: a pedestrian in 2% of the frames, so the 90th percentile of their scores sits where (0.1 - 0.02 TP) / 0.98 of the pedestrian-free frames alarm */
  const lg = SV.evidence.logs(2000, 28000000).map((f) => SV.score(m, f.x).s), tl = SV.thrAtFPR(lg, 0.1), tp = 1 - missAt(tl);
  put('logs_fa', pc(faAt(tl)), 1); put('logs_formula', pc((0.1 - 0.02 * tp) / 0.98), 1); put('logs_miss_shift', pc(missAt(tl) - m10), 1); put('logs_tp', pc(tp), 0);
  near(faAt(tl), (0.1 - 0.02 * tp) / 0.98, 0.012, 'the logs\' 90th percentile lets (0.1 - 0.02 TP)/0.98 of the pedestrian-free frames alarm');
  put('logs_sd_fa_1000', pc(Math.sqrt(0.09 / 1000)), 1); put('logs_bias', 10 - pc(faAt(tl)), 1);
  check(/pPed = 0\.02/.test(String(SV.real.logs)), 'unlabelled frames hold a pedestrian with probability 0.02');
}


/* ───────────── 4. the learning curves of the builder: means, spreads, the claims the prose makes ───────────── */
const cellOf = (k, M) => D.cells[k][M];
const mn = (k, M) => mean(cellOf(k, M).realMiss), rng_ = (k, M) => Math.max(...cellOf(k, M).realMiss) - Math.min(...cellOf(k, M).realMiss);
for (const k of ['R', 'F', 'C', 'CF']) for (const M of (k === 'C' ? GRID : MS)) { put('m_' + k + '_' + M, pc(mn(k, M)), 1); put('sp_' + k + '_' + M, pc(rng_(k, M)), 1); }
check(D.protocol.N === 1600 && SEEDS.length === 3 && D.protocol.seedsR.length === 6, 'protocol: 1,600 synthetic frames, three afternoons, six for the real-only curve');
const Rm = MS.map((M) => mn('R', M)), Cm = GRID.map((M) => mn('C', M)), CFm = MS.map((M) => mn('CF', M)), Fm = MS.map((M) => mn('F', M));
const interp = (xs, ys, x) => { if (x <= xs[0]) return ys[0]; for (let i = 1; i < xs.length; i++) if (x <= xs[i]) { const t = (Math.log(x) - Math.log(xs[i - 1])) / (Math.log(xs[i]) - Math.log(xs[i - 1])); return ys[i - 1] + t * (ys[i] - ys[i - 1]); } return ys[ys.length - 1]; };
const aft = (k, M) => cellOf(k, M).realMiss;                   // afternoon by afternoon (R has six: its first three are the same afternoons as the others')
const L4e = mean(SV.L04.est.lum.realMiss), L5pair = mean(SV.L05.comp['dist+emerge'].realMiss), L5est200 = mean(SV.L05.est[200].realMiss);
put('l4_est_lum', pc(L4e), 1); put('l5_pair', pc(L5pair), 1); put('l5_est200', pc(L5est200), 1); put('l3_cal1', pc(mean(SV.L03.cal[1].realMiss)), 1);
put('gap_free', pc(meanOf('aaaa') - mn('C', 0)), 0); put('gap_rest', pc(mn('C', 0) - mn('R', 1600)), 0);
check(mn('C', 0) < meanOf('aaaa') - 0.15 && Math.abs(mn('C', 0) - L4e) < 0.02, 'the free repairs: camera from a bench kit and brightness from logs, no labelled frame: ' + F.m_C_0 + ' against the naive ' + F.m_naive + ' and Lesson 4\'s ' + F.l4_est_lum);
{ const cs = MS.filter((M) => M >= 50).map((M) => mn('C', M)); put('c_flat_spread', pc(Math.max(...cs) - Math.min(...cs)), 1); put('c_plateau', pc(mean(cs)), 1);
  check(Math.max(...cs) - Math.min(...cs) < 0.025, 'calibration stops helping at 50 labelled frames: C is flat to ' + F.c_flat_spread + ' points from M = 50'); put('c_vs_l5', F.c_plateau - F.l5_pair, 1);
  check(F.c_plateau > F.l5_pair && F.c_plateau - F.l5_pair < 6, 'the evidence-built program lands a few points short of the exact pedestrian settings of Lesson 5'); }
/* paired by afternoon: CF - R at the same labelled frames */
for (const M of MS) { const d = [0, 1, 2].map((s) => aft('CF', M)[s] - aft('R', M)[s]); put('d_cf_r_' + M, pc(mean(d)), 1); put('n_cf_wins_' + M, d.filter((x) => x < 0).length, 0); }
for (const M of [25, 50, 100]) check(F['n_cf_wins_' + M] === 3, 'CF beats R in all three afternoons at M = ' + M);
for (const M of [400, 800, 1600]) check(F['d_cf_r_' + M] > 0.005, 'past a few hundred frames the real frames alone do better: CF - R at M = ' + M + ' is ' + F['d_cf_r_' + M]);
for (const M of [25, 50, 100, 200]) { const d = mean(aft('F', M).map((v, s) => v - aft('CF', M)[s])); put('d_f_cf_' + M, pc(d), 1); check(d > 0.03, 'the calibrated program is worth points inside the mixture at M = ' + M + ': ' + F['d_f_cf_' + M]); }
for (const M of MS) { const d = mean([0, 1, 2].map((r) => aft('F', M)[r] - aft('R', M)[r])); put('d_f_r_' + M, pc(d), 1); }
check(F.d_f_r_25 < -3 && MS.slice(1).every((M) => F['d_f_r_' + M] > -0.5) && F.d_f_r_1600 > 5, 'F beats R only at 25 frames (' + F.d_f_r_25 + ') and sits well behind it at 1,600 (' + F.d_f_r_1600 + ')');
{ const cf = MS.filter((M) => M >= 50).map((M) => mn('CF', M)); put('cf_flat_spread', pc(Math.max(...cf) - Math.min(...cf)), 1); put('cf_plateau', pc(mean(cf)), 1); check(Math.max(...cf) - Math.min(...cf) < 0.03, 'CF is flat from M = 50 on'); }
const crossAt = (xs, ys, zs) => { for (let i = 1; i < xs.length; i++) { const d0 = ys[i - 1] - zs[i - 1], d1 = ys[i] - zs[i]; if (d0 > 0 && d1 <= 0) { const t = d0 / (d0 - d1); return Math.exp(Math.log(xs[i - 1]) + t * (Math.log(xs[i]) - Math.log(xs[i - 1]))); } } return null; };
put('x_r_cf', crossAt(MS, Rm, CFm), 0); put('x_r_c', crossAt(MS, Rm, MS.map((M) => mn('C', M))), 0);
check(F.x_r_cf > 100 && F.x_r_cf < 600, 'the real frames alone overtake the calibrated program\'s mixture between 100 and 600 frames (' + F.x_r_cf + ')');

/* ───────────── 5. the real-only curve refitted (Nelder-Mead on a + b M^-c) and what the curves equal in real-only frames ───────────── */
function nelderMead(f, x0, step, iters) {
  const n = x0.length; let P = [x0.slice()]; for (let i = 0; i < n; i++) { const x = x0.slice(); x[i] += step[i]; P.push(x); }
  let V = P.map(f);
  for (let it = 0; it < iters; it++) {
    const idx = V.map((v, i) => i).sort((a, b) => V[a] - V[b]); P = idx.map((i) => P[i]); V = idx.map((i) => V[i]);
    const c = P[0].map((_, j) => mean(P.slice(0, n).map((p) => p[j]))), refl = c.map((v, j) => v + (v - P[n][j])), fr = f(refl);
    if (fr < V[0]) { const ex = c.map((v, j) => v + 2 * (v - P[n][j])), fe = f(ex); if (fe < fr) { P[n] = ex; V[n] = fe; } else { P[n] = refl; V[n] = fr; } }
    else if (fr < V[n - 1]) { P[n] = refl; V[n] = fr; }
    else { const co = c.map((v, j) => v + 0.5 * (P[n][j] - v)), fc = f(co); if (fc < V[n]) { P[n] = co; V[n] = fc; } else { for (let i = 1; i <= n; i++) { P[i] = P[i].map((v, j) => P[0][j] + 0.5 * (v - P[0][j])); V[i] = f(P[i]); } } }
  }
  const b = V.indexOf(Math.min(...V)); return { x: P[b], f: V[b] };
}
const RPTS = []; for (const M of MS) for (const y of cellOf('R', M).realMiss) RPTS.push([M, y]);
const sse = (q) => (q[1] <= 0 || q[2] <= 0 || q[0] < 0 ? 1e9 : RPTS.reduce((t, [M, y]) => t + (y - q[0] - q[1] * Math.pow(M, -q[2])) ** 2, 0));
const fitNM = nelderMead(sse, [0.45, 1.0, 0.5], [0.05, 0.5, 0.2], 600), fit = { a: fitNM.x[0], b: fitNM.x[1], c: fitNM.x[2] };
put('fit_a', pc(fit.a), 1); put('fit_b', pc(fit.b), 0); put('fit_c', fit.c, 2); put('fit_rms', pc(Math.sqrt(fitNM.f / RPTS.length)), 2);
const curveR = (M) => fit.a + fit.b * Math.pow(M, -fit.c), eqR = (m) => (m <= fit.a ? Infinity : Math.pow((m - fit.a) / fit.b, -1 / fit.c));
for (const [name, m] of [['naive', meanOf('aaaa')], ['c0', mn('C', 0)], ['c50', mn('C', 50)], ['c200', mn('C', 200)], ['cf200', mn('CF', 200)], ['cf400', mn('CF', 400)], ['exact', meanOf('bbba')]]) { const e = eqR(m); put('eq_' + name, Number.isFinite(e) ? e : 1e9, 0); }
/* the worth of what a strategy trains, in real-only frames */
const E = (m) => eqR(m);
const cplat = mean(MS.filter((M) => M >= 50).map((M) => mn('C', M)));
put('eq_cplat', E(cplat), 0); put('rho_c', E(cplat) / 1600, 3); put('k_synth', 1600 / E(cplat), 0); put('lev_c_50', E(mn('C', 50)) / 50, 1);
for (const M of [25, 50, 100, 200, 400]) { put('eq_cf_' + M, Number.isFinite(E(mn('CF', M))) ? E(mn('CF', M)) : 1e9, 0); put('lev_cf_' + M, E(mn('CF', M)) / M, 1); }
put('eq_naive', E(meanOf('aaaa')), 0); put('rho_naive', E(meanOf('aaaa')) / 1600, 3);
put('d_exact_real', pc(Math.abs(meanOf('bbba') - mean(T.curve.real[1600].realMiss))), 1);
check(F.d_exact_real < 1.0, 'the exact-stage program at 1,600 frames equals the street-trained detector at 1,600 (the table\'s own curve) to within a point: worth 1.0');
check(F.eq_naive < 25, 'the naive program\'s detector is worse than 25 real frames: worth about nothing');
check(F.lev_cf_50 > 2 && F.lev_cf_100 > 1.5, 'calibrate-then-fine-tune is worth several real training frames per frame at 50 and 100 frames');
// the weight of a real frame at M = 200 and 800 (one afternoon): the sweeps of the builder
const sw = (k, M) => D.sweep.filter((r) => r.kind === k && r.M === M).sort((a, b) => a.w - b.w);
for (const [k, M] of [['F', 200], ['CF', 200], ['CF', 800]]) sw(k, M).forEach((r) => put('w_' + k + '_' + M + '_' + r.w, pc(r.realMiss), 1));
{ const f = sw('F', 200).map((r) => r.realMiss), c = sw('CF', 200).map((r) => r.realMiss); put('w_spread_F', pc(Math.max(...f) - Math.min(...f)), 1); put('w_spread_CF', pc(Math.max(...c) - Math.min(...c)), 1); check(F.w_spread_F > F.w_spread_CF + 2, 'the naive program is sensitive to the weight of a real frame, the calibrated program is not: ' + F.w_spread_F + ' against ' + F.w_spread_CF); }

/* ───────────── 6. spending a budget: the split that certifies the strictest bound, by a scan over every integer split ───────────── */
/* the policy: the best of the four strategies at a training budget Mt (lower envelope of the means, linear in log M between the measured budgets, flat beyond 1,600); the split is the best of the measured training budgets */
const policy = (Mt) => (Mt <= 0 ? mn('C', 0) : Math.min(interp(MS, Rm, Mt), interp(MS, Fm, Mt), interp(MS.concat([]), MS.map((M) => mn('C', M)), Mt), interp(MS, CFm, Mt)));
function certify(p, G) { const n = ppf * G; return n < 1 ? 1 : Math.min(1, p + Z * Math.sqrt(p * (1 - p) / n)); }
function bestSplit(M) { let best = null; for (const Mt of MS) { if (Mt >= M) continue; const p = policy(Mt), b = certify(p, M - Mt); if (!best || b < best.bound - 1e-12) best = { train: Mt, grade: M - Mt, p, bound: b }; } return best; }
const BUD = [100, 200, 400, 800, 1600, 4500];
for (const M of BUD) { const b = bestSplit(M); put('bs_train_' + M, b.train, 0); put('bs_grade_' + M, b.grade, 0); put('bs_p_' + M, pc(b.p), 1); put('bs_bound_' + M, pc(b.bound), 1); put('bs_price_' + M, pc(b.bound - b.p), 1); put('bs_hw_' + M, pc(Z * Math.sqrt(b.p * (1 - b.p) / (ppf * b.grade))), 1); }
function framesToCertify(t) { let best = null; for (const Mt of MS) { const p = policy(Mt), m = t - p; if (m <= 0) continue; const G = Math.ceil(Z * Z * p * (1 - p) / (m * m) / ppf), tot = Mt + G; if (!best || tot < best.total) best = { train: Mt, grade: G, p, total: tot }; } return best; }
for (const t of [60, 55, 52]) { const b = framesToCertify(t / 100); put('ft_train_' + t, b.train, 0); put('ft_grade_' + t, b.grade, 0); put('ft_total_' + t, b.total, 0); }
put('exit_p', F.bs_p_400, 1);
put('hw_400', pc(Z * Math.sqrt(0.47 * 0.53 / (ppf * 400))), 1); put('sd_exam', pc(Math.sqrt(0.47 * 0.53 / nEx)), 1);

/* the checkpoint: a project with 600 labelled frames plans a held-out set that reads a 50% miss rate (the widest case) to +-8 points */
{
  const nraw = Z * Z * 0.25 / (0.08 * 0.08), n = needScan(0.5, 0.08), fr = n / ppf, frames = Math.ceil(fr), left = 600 - frames, p = policy(left);
  check(n === Math.ceil(nraw - 1e-9), 'scan and closed form agree for the checkpoint');
  put('ck_nraw', nraw, 2); put('ck_n', n, 0); put('ck_fraw', fr, 1); put('ck_frames', frames, 0); put('ck_left', left, 0); put('ck_p', pc(p), 1); put('ck_cert', pc(certify(p, frames)), 1);
}

/* ───────────── 7. two trained cells from scratch, with this file's own composition of the estimators of Lessons 3-5 ───────────── */
const r5 = (x) => +Number(x).toPrecision(5), SEED = { kit: 140, logs: 21000000, labelled: 22000000, train: 23000000, step: 10000 };
const RE = SV.REAL.scene;
function examOwn(model) {
  const sT = test.map((f) => SV.score(model, f.x).s), sV = val.map((f) => SV.score(model, f.x).s), neg = sV.filter((_, i) => !val[i].y).sort((a, b) => a - b), thr = neg[Math.min(neg.length - 1, Math.floor(0.9 * neg.length))];
  let k = 0, n = 0; test.forEach((f, i) => { if (f.y && f.area >= 6) { n++; if (sT[i] > thr) k++; } }); return 1 - k / n;
}
{
  const r = 1, labelled = SV.real.labeled(100, SEED.labelled + SEED.step * r), m = SV.train(labelled, { seed: r + 1 });
  const ms = examOwn(m); near(ms, cellOf('R', 100).realMiss[r], 1e-4, 'R at 100 frames, afternoon 2, recomputed from scratch'); put('anchor_R100', pc(ms), 2);
}
{
  const r = 0, kit = L3.kit(1, SEED.kit + r), est = L3.calibrate(kit.flats, kit.edges, kit.logs), logs = SV.evidence.logs(1000, SEED.logs + SEED.step * r), le = L4.estimate(logs);
  const fr = SV.real.labeled(50, SEED.labelled + SEED.step * r), rs = fr.map((f) => L5.ruler(L5.labelSample(f))), e = L5.estimate(rs, { bias: SV.L05.calib.bias, kappa: SV.L05.calib.kappa });
  const pipe = SV.clone(SV.SIM0); pipe.sensor = L3.camOf(est); pipe.look = L4.estimatedLook(le, ['lum']); pipe.scene.z = [e.zlo, e.zhi]; pipe.scene.pEmerge = Math.round(1e6 * Math.min(1, e.pEmerge / pipe.scene.pVan)) / 1e6;
  near(e.zhi, D.est[50].zhi[0], 0.006, 'the scene read from 50 frames of afternoon 1: farthest pedestrian'); near(e.pEmerge, D.est[50].pEmerge[0], 1e-4, '  step-out probability');
  const syn = SV.makeSet(pipe, 1600, SEED.train + SEED.step * r), ms = examOwn(SV.train(syn, { seed: r + 1 }));
  near(ms, cellOf('C', 50).realMiss[r], 1e-4, 'C at 50 frames, afternoon 1, recomputed from scratch'); put('anchor_C50', pc(ms), 2);
  /* LAB PRIVILEGE: the estimates against the street's own settings (SV.REAL) */
  put('true_zlo', RE.z[0], 0); put('true_zhi', RE.z[1], 0); put('true_pe', RE.pVan * RE.pEmerge, 2);
  near(est.fw, SV.REAL.sensor.fw, 0.02 * SV.REAL.sensor.fw, 'the bench session reads the full well (lab privilege: SV.REAL)');
}


/* ───────────── 7b · what the evidence reads: three afternoons, with this file's own calls (the table of section 3 of the page) ───────────── */
const sd1 = (a) => { const m = mean(a); return Math.sqrt(a.reduce((t, x) => t + (x - m) * (x - m), 0) / (a.length - 1)); };       // sample sd over the afternoons
const CAL = { bias: SV.L05.calib.bias, kappa: SV.L05.calib.kappa };
const RS = [0, 1, 2].map((r) => { const rs = []; for (let i = 0; i < 800; i++) rs.push(L5.ruler(L5.labelSample(SV.sample(SV.REAL, SEED.labelled + SEED.step * r + i)))); return rs; });
for (const M of [25, 50, 100, 200, 800]) {
  const es = RS.map((rs) => L5.estimate(rs.slice(0, M), CAL));
  [['zlo', 'zlo', 0.006], ['zhi', 'zhi', 0.006], ['pe', 'pEmerge', 1e-4]].forEach(([key, k, tol]) => {
    const v = es.map((e) => e[k]); put(key + '_' + M, mean(v), 4); put(key + '_' + M + '_sd', sd1(v), 4);
    v.forEach((x, r) => near(x, D.est[M][k][r], tol, 'the ' + k + ' read from ' + M + ' labelled frames, afternoon ' + (r + 1) + ', against the builder\'s'));
  });
  put('n_ped_' + M, mean(es.map((e) => e.n)), 1);
}
{
  const fw = [], lo = [], hi = [];
  for (let r = 0; r < 3; r++) {
    const kit = L3.kit(1, SEED.kit + r), cam = L3.calibrate(kit.flats, kit.edges, kit.logs), le = L4.estimate(SV.evidence.logs(1000, SEED.logs + SEED.step * r));
    fw.push(cam.fw); lo.push(le.lum[0]); hi.push(le.lum[1]);
    near(cam.fw, D.est[50].fw[r], 0.06, 'the full well read from the kit, afternoon ' + (r + 1)); near(le.lum[0], D.est[50].lumLo[r], 6e-5, 'the dimmest brightness read from the logs'); near(le.lum[1], D.est[50].lumHi[r], 6e-5, 'the brightest');
  }
  put('fw_est', mean(fw), 1); put('fw_sd', sd1(fw), 1); put('lum_lo', mean(lo), 3); put('lum_lo_sd', sd1(lo), 3); put('lum_hi', mean(hi), 3); put('lum_hi_sd', sd1(hi), 3);
  /* LAB PRIVILEGE: the street's own full well and brightness range */
  put('true_fw', SV.REAL.sensor.fw, 0); put('true_lum_lo', SV.REAL.look.lum[0], 2); put('true_lum_hi', SV.REAL.look.lum[1], 2);
}

/* ───────────── 8. the exit: a rate per frame is not a probability per approach ───────────── */
{
  const SH = { v: 7, a: 3, tau: 0.4, dt: 0.1 };                       // the lab's assumptions (not facts about any vehicle): the shuttle of Lesson 11 (7 m/s, 3 m/s^2, 0.4 s)
  const dStop = SH.v * SH.tau + SH.v * SH.v / (2 * SH.a);
  put('d_stop', dStop, 2); put('d_react', SH.v * SH.tau, 1); put('d_brake', SH.v * SH.v / (2 * SH.a), 1); put('d_frame', SH.v * SH.dt, 1);
  /* the approach played frame by frame: the frames recorded while a brake commanded in that frame still stops short of the pedestrian */
  const framesAvail = (z0) => { let k = 0; for (let j = 0; j < 1000; j++) { if (z0 - SH.v * j * SH.dt < dStop - 1e-9) break; k++; } return k; };
  const p = F.exit_p / 100;
  for (const z0 of [12, 14, 16, 20]) {
    const k = framesAvail(z0); put('k_' + z0, k, 0);
    put('ind_' + z0, pc(Math.pow(p, k)), 2); put('cor_' + z0, pc(p), 1);
    /* the pedestrian-level spread by Monte Carlo: q ~ Beta(a, b) by two gamma draws, each pedestrian missed in all k frames with probability q^k */
    const rho = 0.5, a = p * (1 - rho) / rho, b = (1 - p) * (1 - rho) / rho, rng = SV.rng(900 + z0);
    const gamma = (sh) => { if (sh < 1) return gamma(sh + 1) * Math.pow(rng(), 1 / sh); const d = sh - 1 / 3, c = 1 / Math.sqrt(9 * d); for (;;) { let x, v; do { x = SV.randn(rng); v = 1 + c * x; } while (v <= 0); v = v * v * v; const u = rng(); if (Math.log(u) < 0.5 * x * x + d - d * v + d * Math.log(v)) return d * v; } };
    let acc = 0; const B = 200000; for (let i = 0; i < B; i++) { const g1 = gamma(a), g2 = gamma(b), q = g1 / (g1 + g2); acc += Math.pow(q, k); }
    put('bb_' + z0, pc(acc / B), 2);
    let cf = 1; for (let i = 0; i < k; i++) cf *= (a + i) / (a + b + i);
    near(acc / B, cf, Math.max(0.004, 0.03 * cf), 'beta-binomial closed form against Monte Carlo at ' + z0 + ' m');
    check(Math.pow(p, k) <= cf + 1e-12 && cf <= p + 1e-12, 'independent <= correlated at rho = 0.5 <= fully correlated, at ' + z0 + ' m');
  }
  put('ratio_16', F.cor_16 / F.ind_16, 0);
  put('ped_logs', 2, 0); put('ped_prog', pc(SV.SIM0.scene.pPed), 0); put('vanish', 100 * (1 - 0.02 / SV.SIM0.scene.pPed), 0);
}


/* ───────────── 8b · facts the prose adds ───────────── */
{
  /* interval coverage by exact enumeration of the binomial: 11 pedestrians (25 labelled frames), miss rate 0.8 (the naive detector) */
  const lc = (n, k) => { let t = 0; for (let i = 1; i <= k; i++) t += Math.log((n - k + i) / i); return t; };
  const cover = (n, p) => { let cw = 0, cd = 0; for (let k = 0; k <= n; k++) { const pr = Math.exp(lc(n, k) + k * Math.log(p) + (n - k) * Math.log(1 - p)), w = wilson(k, n), ph = k / n, h = Z * Math.sqrt(ph * (1 - ph) / n); if (w[0] <= p && p <= w[1]) cw += pr; if (ph - h <= p && p <= ph + h) cd += pr; } return { wilson: cw, wald: cd }; };
  const ce = cover(11, 0.8), cs = coverage(11, 0.8, 20000, 91);
  put('cov_wilson_11_80', pc(ce.wilson), 1); put('cov_wald_11_80', pc(ce.wald), 1);
  near(cs.wilson, ce.wilson, 0.012, 'simulated Wilson coverage at 11 pedestrians, miss rate 0.8'); near(cs.wald, ce.wald, 0.012, 'simulated normal coverage at 11 pedestrians, miss rate 0.8');
  check(ce.wald < 0.93 && ce.wilson > 0.94, 'at 11 pedestrians and an 80% miss rate the normal interval under-covers and Wilson does not');
  put('ped_25', 25 * ppf, 1);
  for (const M of MS) put('a_cf_r_' + M, Math.abs(F['d_cf_r_' + M]), 1);
  for (const [name, f] of [['half', 0.5], ['quarter', 0.25]]) { const G = Math.round(400 * f), Mt = 400 - G; put('wc_' + name + '_400', pc(certify(policy(Mt), G)), 1); }
}

/*__WIDGET__*/

if (bad) { console.error(bad + ' check(s) failed'); process.exit(1); }
console.log(JSON.stringify({ facts: F }));
