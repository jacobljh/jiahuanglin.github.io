#!/usr/bin/env node
/* Oracle for 3D lesson 13, "Sampling the unseen: generative 3D".
 *
 * Independent pieces (own dense algebra, own posterior, own scores and distances, own denoiser by numerical differentiation of the noised density):
 *   A. the mixture posterior (class evidence and Gaussian per class) rebuilt from the normal equations, against the engine and against a brute-force integral;
 *   B. why squared error returns the mean: E|theta - a|^2 = tr Cov + |a - m|^2, checked on perturbed answers;
 *   C. lesson 12's pool (1500 draws, seed 2468) and the table of answers: mean, mean + noise, likelier kind, a draw;
 *   D. the exact denoiser is -s grad log p_t; the diffusion sampler re-run independently from the same noise; its class shares and spread against the closed form;
 *      the score-difference identity (E[eps_hat - eps] = (s/a) grad_x KL(q_t || p_t)) by direct quadrature in one dimension;
 *   E. score distillation re-implemented from the lesson's equations (numerical scores, same random stream) and compared with the engine; its class shares, the
 *      guidance table, the nearest-hill explanation;
 *   F. four views drawn independently or jointly; consecutive draws that change kind;
 *   G. the widget, driven into every state quoted in "What to try".
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '../../../all_lessons');
const DIR = fs.existsSync(path.join(ROOT, 'computer_vision_3d_new')) ? path.join(ROOT, 'computer_vision_3d_new') : path.join(ROOT, 'computer_vision_3d');
const FL = require(path.join(DIR, 'flatland.js'));
const L13 = require(path.join(DIR, 'l13_sampling.js'));
const { loadPage } = require('../dom_probe.js');
const SH = FL.shape;

let fails = 0;
const facts = {};
function ok(name, cond, extra) { if (!cond) { fails++; console.error('FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); } }
const close = (a, b, tol) => Math.abs(a - b) <= (tol === undefined ? 1e-9 : tol);

/* ───────────── own dense algebra on arrays of arrays ───────────── */
const zeros = (n, m) => Array.from({ length: n }, () => new Array(m).fill(0));
const mm = (A, B) => A.map(r => B[0].map((_, j) => r.reduce((s, v, k) => s + v * B[k][j], 0)));
const tr = A => A[0].map((_, j) => A.map(r => r[j]));
const mv = (A, x) => A.map(r => r.reduce((s, v, k) => s + v * x[k], 0));
const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
const eye = n => Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));
function inv(A) {                                                    // Gauss-Jordan with partial pivoting
  const n = A.length, M = A.map((r, i) => r.concat(eye(n)[i]));
  for (let i = 0; i < n; i++) {
    let p = i; for (let k = i + 1; k < n; k++) if (Math.abs(M[k][i]) > Math.abs(M[p][i])) p = k;
    [M[i], M[p]] = [M[p], M[i]];
    const d = M[i][i]; for (let j = 0; j < 2 * n; j++) M[i][j] /= d;
    for (let k = 0; k < n; k++) if (k !== i) { const f = M[k][i]; if (f) for (let j = 0; j < 2 * n; j++) M[k][j] -= f * M[i][j]; }
  }
  return M.map(r => r.slice(n));
}
function logdet(A) {                                                 // by LU without pivoting (matrices here are positive definite)
  const n = A.length, U = A.map(r => r.slice()); let ld = 0;
  for (let i = 0; i < n; i++) { ld += Math.log(U[i][i]); for (let k = i + 1; k < n; k++) { const f = U[k][i] / U[i][i]; for (let j = i; j < n; j++) U[k][j] -= f * U[i][j]; } }
  return ld;
}
function chol(A) { const n = A.length, L = zeros(n, n); for (let i = 0; i < n; i++) for (let j = 0; j <= i; j++) { let s = A[i][j]; for (let k = 0; k < j; k++) s -= L[i][k] * L[j][k]; L[i][j] = i === j ? Math.sqrt(s) : s / L[j][j]; } return L; }
const logN = (x, m, C) => { const d = x.map((v, i) => v - m[i]), Ci = inv(C); return -0.5 * (dot(d, mv(Ci, d)) + logdet(C) + x.length * Math.log(2 * Math.PI)); };
const toA = (v, n) => { const r = []; for (let i = 0; i < n; i++) r.push(Array.from(v.slice(i * n, (i + 1) * n))); return r; };
const D = 10;

/* ───────────── the world, written out again ───────────── */
const KM = SH.M.map(r => Array.from(r));                              // the two factor shapes (and a third that the two kinds do not use)
const KIND = L13.classes().map(c => ({ pi: c.pi, mu: Array.from(c.mu), Lam: toA(c.Lam, D) }));
const design = phis => phis.map(p => { const r = []; for (let k = 1; k <= 5; k++) r.push(Math.cos(k * p), Math.sin(k * p)); return r; });
const radius = (th, p) => { let r = 1; for (let k = 1; k <= 5; k++) r += th[2 * k - 2] * Math.cos(k * p) + th[2 * k - 1] * Math.sin(k * p); return r; };
const zOf = th => [0, 1].map(c => dot(th, KM[c]) / dot(KM[c], KM[c]));
const hyb = th => { const z = zOf(th); return Math.min(Math.abs(z[0]), Math.abs(z[1])); };
const ALPHA = Math.PI / 3, HALF = 25 * Math.PI / 180, FSD = 0.04, CM = 115;
const PROBES = Array.from({ length: 72 }, (_, q) => -Math.PI + 2 * Math.PI * (q + 0.5) / 72).filter(p => { let d = p - ALPHA; d = Math.atan2(Math.sin(d), Math.cos(d)); return Math.abs(d) > HALF + 1e-9; });
const dist = (a, b) => { let s = 0; for (const p of PROBES) s += (radius(a, p) - radius(b, p)) ** 2; return CM * Math.sqrt(s / PROBES.length); };

/* ── A. the mixture posterior from the normal equations ── */
function posterior(fr) {
  const A = design(fr.ang), n = A.length, At = tr(A), r = fr.r.map(v => v - 1), s2 = FSD * FSD;
  const comps = KIND.map(k => {
    const Li = inv(k.Lam), AtA = mm(At, A);
    const P = Li.map((row, i) => row.map((v, j) => v + AtA[i][j] / s2)), S = inv(P);
    const rhs = mv(Li, k.mu).map((v, i) => v + mv(At, r)[i] / s2), m = mv(S, rhs);
    const Sy = mm(mm(A, k.Lam), At).map((row, i) => row.map((v, j) => v + (i === j ? s2 : 0)));       // y ~ N(A mu, A Lam A' + s2 I)
    const ev = logN(r, mv(A, k.mu), Sy);
    return { m, S, lw: Math.log(k.pi) + ev };
  });
  const mx = Math.max(...comps.map(c => c.lw)), Z = comps.reduce((s, c) => s + Math.exp(c.lw - mx), 0);
  comps.forEach(c => { c.w = Math.exp(c.lw - mx) / Z; });
  const mean = comps[0].m.map((_, i) => comps.reduce((s, c) => s + c.w * c.m[i], 0));
  return { comps, mean };
}
const maxDiff = (a, b) => Math.max(...Array.from(a, (v, i) => Math.abs(v - b[i])));
const F = L13.fronts();
{
  F.forEach(f => {
    const P = posterior(f.fr);
    ok('front ' + f.id + ': engine weights == normal equations', close(f.post.w[0], P.comps[0].w, 1e-9), [f.post.w[0], P.comps[0].w]);
    [0, 1].forEach(c => {
      ok('front ' + f.id + ' kind ' + c + ': posterior mean', maxDiff(f.post.comp[c].mean, P.comps[c].m) < 1e-9);
      ok('front ' + f.id + ' kind ' + c + ': posterior covariance', maxDiff(f.post.comp[c].cov, [].concat(...P.comps[c].S)) < 1e-9);
    });
    ok('front ' + f.id + ': mixture mean', maxDiff(f.post.mean, P.mean) < 1e-9);
  });
  ok('the four widget fronts follow the rule that picked them', JSON.stringify(L13.select()) === JSON.stringify(L13.FRONT_IDX), L13.select());
  // the weight against a brute-force integral of the evidence over a coarse grid is not possible in 10-D; check it by Monte Carlo over the prior instead (front A)
  const f = F[0], A = design(f.fr.ang), r = f.fr.r.map(v => v - 1), rng = FL.rng(5);
  const lik = th => { const m = mv(A, th); let q = 0; for (let i = 0; i < r.length; i++) q += (r[i] - m[i]) ** 2; return Math.exp(-q / (2 * FSD * FSD)); };
  const ev = [0, 1].map(c => { const k = L13.classes()[c]; let s = 0; const N = 40000; for (let i = 0; i < N; i++) s += lik(SH.sample({ mean: k.mu, cov: k.Lam }, rng, 1)[0]); return s / N; });
  facts.mc_w_oval = ev[0] / (ev[0] + ev[1]);
  ok('class weight from a Monte Carlo evidence', close(facts.mc_w_oval, f.post.w[0], 0.03), [facts.mc_w_oval, f.post.w[0]]);
}

/* ── lesson 12's pool: 1500 draws, alternating kinds, seed 2468; balanced = posterior probability of each kind between 35 % and 65 % ── */
const POOL = [];
{
  const rng = FL.rng(2468);
  for (let i = 0; i < 1500; i++) { const c = i % 2, th = L13.shape(c, rng), fr = L13.front(th, rng); POOL.push({ c, th, fr, P: posterior(fr) }); }
}
const BAL = POOL.filter(it => Math.abs(it.P.comps[0].w - 0.5) < 0.15);
facts.amb_n = BAL.length; facts.amb_share = 100 * BAL.length / POOL.length; facts.pool_n = POOL.length;
const med = a => { const b = a.slice().sort((x, y) => x - y), k = b.length; return k % 2 ? b[(k - 1) / 2] : 0.5 * (b[k / 2 - 1] + b[k / 2]); };
const qtl = (a, p) => { const b = a.slice().sort((x, y) => x - y); return b[Math.floor(p * (b.length - 1))]; };
const rms = (arr, f) => Math.sqrt(arr.reduce((s, v) => s + f(v) ** 2, 0) / arr.length);
// real objects: the world's hybrid scores
{
  const rng = FL.rng(31337), hs = []; let rare = 0;
  for (let i = 0; i < 4000; i++) { const z = zOf(L13.shape(i % 2, rng)); hs.push(Math.min(Math.abs(z[0]), Math.abs(z[1]))); if (z[0] > 0.8 && z[1] > 0.8) rare++; }
  facts.real_h_med = med(hs); facts.real_h_p95 = qtl(hs, 0.95); facts.real_valid = 100 * hs.filter(h => h <= 0.5).length / hs.length; facts.rare = rare;
  facts.real_h_ge1 = hs.filter(h => h >= 1.0).length; facts.real_h_ge08 = hs.filter(h => h >= 0.8).length;
  ok('lesson 12 counts 6 of 4000 with both scores above 0.8', rare === 6, rare);
  ok('about 95% of real objects have h <= 0.5', close(facts.real_valid, 95, 1), facts.real_valid);
}

/* ── the example front A ── */
{
  const f = F[0], P = posterior(f.fr), z = P.comps.map(c => zOf(c.m)), zm = zOf(P.mean);
  facts.A_w = 100 * P.comps[0].w; facts.A_zo1 = z[0][0]; facts.A_zo2 = z[0][1]; facts.A_zt1 = z[1][0]; facts.A_zt2 = z[1][1];
  facts.A_zm1 = zm[0]; facts.A_zm2 = zm[1]; facts.A_h = hyb(P.mean);
  facts.A_dOT = dist(P.comps[0].m, P.comps[1].m); facts.A_dmo = dist(P.mean, P.comps[0].m); facts.A_dmt = dist(P.mean, P.comps[1].m);
  facts.A_err_mean = dist(P.mean, f.th); facts.A_truth_z1 = zOf(f.th)[0]; facts.A_truth_z2 = zOf(f.th)[1];
  ok('front A: the average sits halfway', close(facts.A_dmo, facts.A_dmt, 0.5) && close(facts.A_dmo, facts.A_dOT / 2, 0.5), [facts.A_dmo, facts.A_dmt, facts.A_dOT]);
  ok('front A is balanced', Math.abs(P.comps[0].w - 0.5) < 0.01);
  ok('lesson 12 reports 25.2 cm between the explanations of its first front', close(facts.A_dOT, 25.2, 0.05), facts.A_dOT);
  // residual of the average on the sixteen readings (the data cannot object to it)
  const A = design(f.fr.ang), pred = mv(A, P.mean).map(v => v + 1);
  facts.A_res_mean = CM * Math.sqrt(f.fr.r.reduce((s, v, i) => s + (v - pred[i]) ** 2, 0) / f.fr.r.length); facts.noise_cm = CM * FSD;
}
/* ── B. squared error asks for the mean ── */
{
  const f = F[0], P = posterior(f.fr), rng = FL.rng(21), N = 60000;
  // draws from the posterior (own sampler: kind by weight, then a Gaussian through an own Cholesky)
  const Ls = P.comps.map(c => chol(c.S));
  const draw = () => { const u = rng(), c = u < P.comps[0].w ? 0 : 1, z = Array.from({ length: D }, () => FL.randn(rng)); return mv(Ls[c], z).map((v, i) => v + P.comps[c].m[i]); };
  const th = Array.from({ length: N }, draw);
  const sq = (a) => th.reduce((s, t) => s + dot(t.map((v, i) => v - a[i]), t.map((v, i) => v - a[i])), 0) / N;
  const trCov = P.comps.reduce((s, c) => s + c.w * (c.S.reduce((q, r, i) => q + r[i], 0) + dot(c.m.map((v, i) => v - P.mean[i]), c.m.map((v, i) => v - P.mean[i]))), 0);
  ok('the mean attains the total posterior variance', close(sq(P.mean) / trCov, 1, 0.015), [sq(P.mean), trCov]);
  const rng2 = FL.rng(3); let worst = 1e9;
  for (let k = 0; k < 6; k++) {
    const d = Array.from({ length: D }, () => 0.05 * FL.randn(rng2)), a = P.mean.map((v, i) => v + d[i]);
    ok('perturbed answer ' + k + ': E|theta-a|^2 = tr Cov + |a-m|^2', close(sq(a), trCov + dot(d, d), 0.012 * trCov), [sq(a), trCov + dot(d, d)]);
    worst = Math.min(worst, sq(a) - sq(P.mean));
  }
  ok('every perturbed answer is worse than the mean', worst > 0, worst);
}

/* ── C. the table of answers over the 372 balanced fronts (20 draws each) ── */
{
  const rng = FL.rng(404), draws = 20, ans = { mean: [], noise: [], mode: [], draw: [] };
  const stat = {};
  BAL.forEach(it => {
    const P = it.P, Ls = P.comps.map(c => chol(c.S));
    const Cm = zeros(D, D); P.comps.forEach(c => { const d = c.m.map((v, i) => v - P.mean[i]); for (let i = 0; i < D; i++) for (let j = 0; j < D; j++) Cm[i][j] += c.w * (c.S[i][j] + d[i] * d[j]); });
    const Lm = chol(Cm), g = () => Array.from({ length: D }, () => FL.randn(rng));
    const mode = P.comps[0].w >= 0.5 ? P.comps[0].m : P.comps[1].m;
    const rowSet = { mean: [P.mean], mode: [mode], noise: [], draw: [] };
    for (let k = 0; k < draws; k++) {
      rowSet.noise.push(mv(Lm, g()).map((v, i) => v + P.mean[i]));
      const c = rng() < P.comps[0].w ? 0 : 1; rowSet.draw.push(mv(Ls[c], g()).map((v, i) => v + P.comps[c].m[i]));
    }
    for (const k in rowSet) (stat[k] = stat[k] || []).push(rowSet[k].map(th => ({ err: dist(th, it.th), h: hyb(th), th })));
  });
  const summary = k => {
    const all = [].concat(...stat[k]); let pd = 0, np = 0;
    stat[k].forEach(arr => { for (let i = 0; i + 1 < arr.length; i += 2) { pd += dist(arr[i].th, arr[i + 1].th) ** 2; np++; } });
    return { err: Math.sqrt(all.reduce((s, v) => s + v.err ** 2, 0) / all.length), valid: 100 * all.filter(v => v.h <= 0.5).length / all.length, hmed: med(all.map(v => v.h)), differ: np ? Math.sqrt(pd / np) : 0 };
  };
  for (const k of ['mean', 'noise', 'mode', 'draw']) { const s = summary(k); facts['tab_err_' + k] = s.err; facts['tab_valid_' + k] = s.valid; facts['tab_h_' + k] = s.hmed; facts['tab_differ_' + k] = s.differ; }
  facts.tab_ratio_draw_mean = facts.tab_err_draw / facts.tab_err_mean;
  ok('a draw errs by about sqrt(2) times the mean (independent of the truth given the photographs)', close(facts.tab_ratio_draw_mean, Math.SQRT2, 0.05), facts.tab_ratio_draw_mean);
  ok('lesson 12: the best squared-error answer errs by 12.5 cm and the likelier kind by 15.1 cm', close(facts.tab_err_mean, 12.5, 0.1) && close(facts.tab_err_mode, 15.1, 0.1), [facts.tab_err_mean, facts.tab_err_mode]);
  ok('the mean is a valid object in a minority of balanced fronts', facts.tab_valid_mean < 35, facts.tab_valid_mean);
  ok('draws are valid like real objects', close(facts.tab_valid_draw, facts.real_valid, 2.5), [facts.tab_valid_draw, facts.real_valid]);
  facts.tab_hmed_real = facts.real_h_med;
  // residual of the mean on the readings, over balanced fronts
  const resid = th => CM * rms(BAL, it => { const A = design(it.fr.ang), pr = mv(A, th(it)); return Math.sqrt(it.fr.r.reduce((s, v, i) => s + (v - 1 - pr[i]) ** 2, 0) / it.fr.r.length); });
  facts.res_mean_bal = resid(it => it.P.mean); facts.res_o_bal = resid(it => it.P.comps[0].m); facts.res_t_bal = resid(it => it.P.comps[1].m);
  {  // the page says: the average's residual vector is the weighted average of the two explanations' residual vectors, hence no longer than the weighted average of their lengths
    let worst = -1e9, vec = 0;
    BAL.forEach(it => {
      const A = design(it.fr.ang), r = it.fr.r.map(v => v - 1), res = th => { const p = mv(A, th); return r.map((v, i) => v - p[i]); }, len = v => Math.sqrt(v.reduce((s, x) => s + x * x, 0));
      const ra = res(it.P.mean), r0 = res(it.P.comps[0].m), r1 = res(it.P.comps[1].m), w0 = it.P.comps[0].w, w1 = it.P.comps[1].w;
      worst = Math.max(worst, len(ra) - (w0 * len(r0) + w1 * len(r1)));
      vec = Math.max(vec, len(ra.map((v, i) => v - (w0 * r0[i] + w1 * r1[i]))));
    });
    ok('the average\'s residual vector is the weighted average of the explanations\' (affine in the outline)', vec < 1e-12, vec);
    ok('... so it is no longer than the weighted average of their lengths', worst <= 1e-12, worst);
  }
}


/* ── D. the diffusion sampler.  A mixture noised stays a mixture, so the denoiser (the minimiser of E|eps_hat - eps|^2) is exact: eps = -s grad log p_t ── */
const SC = 0.05, T = 60, TMAX = 0.99;
ok('the engine uses the settings the lesson quotes (60 steps from t = 0.99, scale 0.05)', L13.TDDIM === T && L13.TMAX === TMAX && L13.SC === SC, [L13.TDDIM, L13.TMAX, L13.SC]);
const aT = t => Math.cos(Math.PI * t / 2), sT = t => Math.sin(Math.PI * t / 2);
const mixLogP = (comps, a, s) => {                       // log p_t(z) for z = a x + s eps, x ~ sum_c w_c N(m_c, S_c), written from the definition
  const q = comps.map(c => { const C = c.S.map((row, i) => row.map((v, j) => a * a * v + (i === j ? s * s : 0))); return { Ci: inv(C), ld: logdet(C), c }; });
  return z => {
    const lw = q.map(k => { const d = z.map((v, i) => v - a * k.c.m[i]); return Math.log(k.c.w) - 0.5 * (dot(d, mv(k.Ci, d)) + k.ld + z.length * Math.log(2 * Math.PI)); });
    const mx = Math.max(...lw); return mx + Math.log(lw.reduce((sm, l) => sm + Math.exp(l - mx), 0));
  };
};
const numGrad = (f, z, h) => z.map((_, i) => { const zp = z.slice(), zm = z.slice(); zp[i] += h; zm[i] -= h; return (f(zp) - f(zm)) / (2 * h); });
const epsNum = (comps, a, s, z) => numGrad(mixLogP(comps, a, s), z, 1e-5).map(g => -s * g);
const thetaComps = P => P.comps.map(c => ({ w: c.w, m: c.m.map(v => v / SC), S: c.S.map(r => r.map(v => v / (SC * SC))) }));
const engComps = comps => comps.map(c => ({ w: c.w, m: Float64Array.from(c.m), S: Float64Array.from([].concat(...c.S)) }));
{
  const P = posterior(F[0].fr), cs = thetaComps(P), rng = FL.rng(8);
  let worst = 0;
  for (let k = 0; k < 8; k++) {
    const t = 0.05 + 0.9 * rng(), a = aT(t), s = sT(t), z = Array.from({ length: D }, () => 1.2 * FL.randn(rng));
    const lv = L13.level(engComps(cs), D, a, s), out = new Float64Array(D); L13.epsHat(lv, D, Float64Array.from(z), a, s, out);
    worst = Math.max(worst, maxDiff(out, epsNum(cs, a, s, z)));
  }
  ok('engine denoiser == -s grad log p_t (numerical gradient of the written-out mixture density)', worst < 2e-6, worst);
  facts.denoiser_err = worst;
  // independent re-run of the sampler from the same starting noise
  let dmax = 0;
  for (const seed of [3, 4, 5]) {
    const r = FL.rng(seed), z = Array.from({ length: D }, () => FL.randn(r));
    for (let k = 0; k < T; k++) {
      const t = TMAX * (1 - k / T), t2 = TMAX * (1 - (k + 1) / T), a = aT(t), s = sT(t), e = epsNum(cs, a, s, z);
      const x0 = z.map((v, i) => (v - s * e[i]) / a);
      z.forEach((_, i) => { z[i] = aT(t2) * x0[i] + sT(t2) * e[i]; });
    }
    const eng = L13.reverse(F[0], FL.rng(seed)).th;
    dmax = Math.max(dmax, maxDiff(eng, z.map(v => v * SC)));
  }
  ok('engine sampler == independent sampler (same noise, numerical scores)', dmax < 1e-6, dmax);
}
// the class shares and the spread of the sampler's draws against the closed form
{
  for (const f of [F[0], F[2]]) {
    const R = 2000, th = []; for (let i = 0; i < R; i++) th.push(L13.reverse(f, FL.rng(10000 + i)).th);
    const w = f.post.w[0], share = th.filter(t => zOf(t)[0] > zOf(t)[1]).length / R, se = Math.sqrt(w * (1 - w) / R);
    ok('front ' + f.id + ': the sampler reproduces the kind weights', Math.abs(share - w) < 4 * se, [share, w]);
    const m = new Array(D).fill(0); th.forEach(t => t.forEach((v, i) => { m[i] += v / R; }));
    const spread = Math.sqrt(th.reduce((s, t) => s + t.reduce((q, v, i) => q + (v - m[i]) ** 2, 0), 0) / R);
    const P = posterior(f.fr), exact = Math.sqrt(P.comps.reduce((s, c) => s + c.w * (c.S.reduce((q, r, i) => q + r[i], 0) + dot(c.m.map((v, i) => v - P.mean[i]), c.m.map((v, i) => v - P.mean[i]))), 0));
    ok('front ' + f.id + ': the sampler reproduces the spread', close(spread / exact, 1, 0.03), [spread, exact]);
    ok('front ' + f.id + ': the sampler reproduces the mean', dist(Float64Array.from(m), P.mean) < 1.5, dist(Float64Array.from(m), P.mean));
    const k = f.id; facts['rev_share_' + k] = 100 * share; facts['rev_w_' + k] = 100 * w; facts['rev_spread_' + k] = spread / exact;
  }
  // the clean-sample estimate along the path: starts at the average, ends on an arm
  const f = F[0], R = 400, valid = new Array(T).fill(0); let first = 0, endValid = 0;
  const Pm = L13.zOf(f.post.mean);
  for (let i = 0; i < R; i++) {
    const rv = L13.reverse(f, FL.rng(900 + i)), path = rv.path;
    if (hyb(rv.th) <= 0.5) endValid++;
    path.forEach((z, k) => { if (Math.min(Math.abs(z[0]), Math.abs(z[1])) <= 0.5) valid[k]++; });
    first += Math.hypot(path[0][0] - Pm[0], path[0][1] - Pm[1]) / R;
  }
  const share = k => 100 * valid[k - 1] / R;
  facts.path_first_dist = first; facts.path_v1 = share(1);
  let k50 = 0, k90 = 0; for (let k = 1; k <= T; k++) { if (!k50 && share(k) >= 50) k50 = k; if (!k90 && share(k) >= 90) k90 = k; }
  facts.path_k50 = k50; facts.path_v_k50 = share(k50); facts.path_k90 = k90; facts.path_v_k90 = share(k90); facts.path_vend = 100 * endValid / R;
  ok('the first clean-sample estimate is the average (no path has a valid one yet)', facts.path_v1 <= 1, facts.path_v1);
  const cf = SH.sampleMixture(f.post.comp, FL.rng(6), 4000); facts.cf_valid_A = 100 * cf.filter(t => hyb(t) <= 0.5).length / cf.length;
  ok('by the end the sampler is as valid as the closed-form draws of the same front', close(facts.path_vend, facts.cf_valid_A, 3.5), [facts.path_vend, facts.cf_valid_A]);
  console.error('path validity by step:', Array.from({ length: T }, (_, k) => share(k + 1).toFixed(0)).join(' '));
}
// the score-difference identity, by direct quadrature in one dimension:  E[eps_hat(z) - eps] = (s/a) d/dx KL( q_t(. | x) || p_t )
{
  const cs1 = [{ w: 0.5, m: [-1.5], S: [[0.04]] }, { w: 0.5, m: [1.5], S: [[0.04]] }];
  let worst = 0;
  for (const [x, t] of [[0.3, 0.45], [-0.8, 0.3], [1.1, 0.6]]) {
    const a = aT(t), s = sT(t), lp = mixLogP(cs1, a, s);
    const lv = L13.level(engComps(cs1), 1, a, s), eh = z => { const o = new Float64Array(1); L13.epsHat(lv, 1, Float64Array.from([z]), a, s, o); return o[0]; };
    const gauss = e => Math.exp(-e * e / 2) / Math.sqrt(2 * Math.PI), M = 4001, lo = -9, hi = 9, h = (hi - lo) / (M - 1);
    let lhs = 0; for (let i = 0; i < M; i++) { const e = lo + i * h; lhs += (eh(a * x + s * e) - e) * gauss(e) * h; }
    const KL = xx => { let v = 0; for (let i = 0; i < M; i++) { const e = lo + i * h, z = a * xx + s * e, lq = -e * e / 2 - Math.log(s * Math.sqrt(2 * Math.PI)); v += gauss(e) * h * (lq - lp([z])); } return v; };
    const d = 1e-4, rhs = (s / a) * (KL(x + d) - KL(x - d)) / (2 * d);
    worst = Math.max(worst, Math.abs(lhs - rhs) / Math.max(1e-9, Math.abs(rhs)));
  }
  ok('SDS direction == (s/a) grad_x KL(q_t || p_t) (quadrature, 1-D mixture), to at least six digits', worst < 1e-6, worst); facts.kl_identity_err = worst;
}

/* ── E. score distillation, re-implemented from the lesson's equations: numerical scores of the written-out view densities, the same random stream ── */
const NV = 9, VHALF = 50 * Math.PI / 180, NVIEW = 12, NT = 24, STEPS = 200, LR = 0.03;
ok('the engine uses the settings the lesson quotes (12 views of 9 readings, 24 noise levels, 200 Adam steps at 0.03)', L13.NV === NV && L13.NVIEW === NVIEW && L13.NT === NT && L13.STEPS === STEPS && L13.LR === LR);
const viewA = k => { const al = 2 * Math.PI * k / NVIEW; return design(Array.from({ length: NV }, (_, j) => al + VHALF * (2 * j / (NV - 1) - 1))); };
const VIEWA = Array.from({ length: NVIEW }, (_, k) => viewA(k));
const viewComps = (comps, A) => comps.map(c => ({ w: c.w, m: mv(A, c.m), S: mm(mm(A, c.S), tr(A)) }));       // what a view reads: a linear image of a Gaussian
const WORLD = KIND.map(k => ({ w: k.pi, m: k.mu.map(v => v / SC), S: k.Lam.map(r => r.map(v => v / (SC * SC))) }));
function ownClimb(cs, rng, omega) {
  const cond = VIEWA.map(A => viewComps(cs, A)), unc = VIEWA.map(A => viewComps(WORLD, A)), cache = {};
  const lp = (kind, k, ti) => { const key = kind + k + '_' + ti; if (!cache[key]) { const t = 0.02 + 0.96 * ti / (NT - 1); cache[key] = mixLogP(kind === 'c' ? cond[k] : unc[k], aT(t), sT(t)); } return cache[key]; };
  let th = Array.from({ length: D }, () => 0.2 * FL.randn(rng)), m1 = new Array(D).fill(0), m2 = new Array(D).fill(0);
  for (let k = 1; k <= STEPS; k++) {
    const g = new Array(D).fill(0);
    for (let q = 0; q < 2; q++) {
      const vi = Math.floor(rng() * NVIEW), ti = Math.floor(rng() * NT), t = 0.02 + 0.96 * ti / (NT - 1), a = aT(t), s = sT(t);
      const eps = Array.from({ length: NV }, () => FL.randn(rng)), x = mv(VIEWA[vi], th), z = x.map((v, i) => a * v + s * eps[i]);
      let e = numGrad(lp('c', vi, ti), z, 1e-5).map(v => -s * v);
      if (omega !== 1) { const eu = numGrad(lp('u', vi, ti), z, 1e-5).map(v => -s * v); e = e.map((v, i) => eu[i] + omega * (v - eu[i])); }
      for (let j = 0; j < D; j++) { let gs = 0; for (let i = 0; i < NV; i++) gs += (e[i] - eps[i]) * VIEWA[vi][i][j]; g[j] += s * s * gs / 2; }
    }
    th = th.map((v, j) => { m1[j] = 0.9 * m1[j] + 0.1 * g[j]; m2[j] = 0.999 * m2[j] + 0.001 * g[j] * g[j]; return v - LR * (m1[j] / (1 - 0.9 ** k)) / (Math.sqrt(m2[j] / (1 - 0.999 ** k)) + 1e-8); });
  }
  return th.map(v => v * SC);
}
{
  let dmax = 0;
  for (const [f, om, seed] of [[F[0], 1, 40000], [F[2], 10, 40001], [F[2], 1, 40002]]) {
    const own = ownClimb(thetaComps(posterior(f.fr)), FL.rng(seed), om), eng = L13.climb(f, FL.rng(seed), { omega: om }).th;
    dmax = Math.max(dmax, maxDiff(eng, own) / SC);
  }
  ok('engine score distillation == independent implementation (same random stream, numerical scores), in units of the scale', dmax < 5e-4, dmax);
  facts.sds_impl_err = dmax;
}
// what the climber finds
const climbSet = (f, om, R, seed0) => { const out = []; for (let i = 0; i < R; i++) out.push(L13.climb(f, FL.rng(seed0 + i), { omega: om }).th); return out; };
const sdsStats = (f, th) => {
  const R = th.length, m = new Array(D).fill(0); th.forEach(t => t.forEach((v, i) => { m[i] += v / R; }));
  return { oval: 100 * th.filter(t => zOf(t)[0] > zOf(t)[1]).length / R, valid: 100 * th.filter(t => hyb(t) <= 0.5).length / R, hmed: med(th.map(hyb)),
    spread: Math.sqrt(th.reduce((s, t) => s + t.reduce((q, v, i) => q + (v - m[i]) ** 2, 0), 0) / R),
    pair: Math.sqrt(th.slice(1).reduce((s, t, i) => s + dist(t, th[i]) ** 2, 0) / (R - 1)) };
};
{
  const R = 200;
  for (const f of [F[0], F[1]]) for (const om of [1, 3, 10, 100]) {
    const st = sdsStats(f, climbSet(f, om, R, 40000)); facts['sds_' + f.id + '_oval_' + om] = st.oval;
    ok('front ' + f.id + ' omega ' + om + ': the climber never returns the oval', st.oval <= 1, st.oval);
    if (om === 1) { facts['sds_' + f.id + '_pair'] = st.pair; facts['sds_' + f.id + '_valid'] = st.valid; }
  }
  // the guidance table, front C (the oval is 4 : 1 likelier)
  for (const om of [1, 3, 10, 100]) { const st = sdsStats(F[2], climbSet(F[2], om, R, 40000)); facts['sds_C_oval_' + om] = st.oval; facts['sds_C_valid_' + om] = st.valid; facts['sds_C_h_' + om] = st.hmed; }
  ok('front C, omega 1: neither kind wins cleanly and many endpoints are blends', facts.sds_C_oval_1 > 25 && facts.sds_C_oval_1 < 75 && facts.sds_C_valid_1 < 80, [facts.sds_C_oval_1, facts.sds_C_valid_1]);
  ok('front C, omega 3 and 10: the likelier kind every time, valid objects', facts.sds_C_oval_3 >= 98 && facts.sds_C_oval_10 >= 98 && facts.sds_C_valid_3 >= 98 && facts.sds_C_valid_10 >= 98);
  ok('front C, omega 100: the likelier kind but pushed off the family', facts.sds_C_oval_100 >= 98 && facts.sds_C_valid_100 < 75, [facts.sds_C_oval_100, facts.sds_C_valid_100]);
  // diversity: pair distance of draws vs of climbs on front A
  const th = F[0] && SH.sampleMixture(F[0].post.comp, FL.rng(12), R); facts.draw_pair_A = Math.sqrt(th.slice(1).reduce((s, t, i) => s + dist(t, th[i]) ** 2, 0) / (R - 1));
  ok('draws differ by many centimetres, climbs by a few', facts.draw_pair_A > 4 * facts.sds_A_pair, [facts.draw_pair_A, facts.sds_A_pair]);
  // the nearer hill: from a round start, the trefoil is the nearer mode on every balanced front
  const z0 = new Array(D).fill(0); let nearT = 0;
  BAL.forEach(it => { if (dist(z0, it.P.comps[1].m) < dist(z0, it.P.comps[0].m)) nearT++; });
  facts.near_t = nearT; ok('on every balanced front the trefoil mode is nearer to the round start', nearT === BAL.length, nearT);
  const fa = posterior(F[0].fr); facts.A_blob_o = dist(z0, fa.comps[0].m); facts.A_blob_t = dist(z0, fa.comps[1].m);
}
// across many fronts: validity of the endpoints as the guidance grows
{
  const fr = L13.draws().slice(0, 120), acc = { 1: 0, 3: 0, 10: 0, 100: 0 }, lik = { 1: 0, 3: 0, 10: 0, 100: 0 }; let n = 0;
  fr.forEach((d, i) => {
    const f = { th: d.th, fr: d.fr, post: L13.posterior(d.fr), n: 0, cache: {} };
    for (const om of [1, 3, 10, 100]) for (let r = 0; r < 2; r++) { const th = L13.climb(f, FL.rng(50000 + 7 * i + r), { omega: om }).th; if (hyb(th) <= 0.5) acc[om]++; if ((zOf(th)[0] > zOf(th)[1]) === (f.post.w[0] > 0.5)) lik[om]++; }
    n += 2;
  });
  for (const om of [1, 3, 10, 100]) { facts['agg_valid_' + om] = 100 * acc[om] / n; facts['agg_lik_' + om] = 100 * lik[om] / n; }
  ok('across 120 fronts the endpoints stay valid at modest guidance and leave the family at 100', facts.agg_valid_3 > 85 && facts.agg_valid_100 < facts.agg_valid_3 - 15, [facts.agg_valid_3, facts.agg_valid_100]);
  ok('guidance makes the climber commit to the likelier kind', facts.agg_lik_10 > facts.agg_lik_1 + 8, [facts.agg_lik_1, facts.agg_lik_10]);
}
// one climb from each of 60 balanced fronts (every sixth of the 372): the trefoil is the nearer hill, so that is where it ends
{
  const sel = BAL.filter((_, i) => i % 6 === 0).slice(0, 60); let nT = 0;
  sel.forEach((it, i) => { const f = { th: it.th, fr: it.fr, post: L13.posterior(it.fr), n: 0, cache: {} }; const th = L13.climb(f, FL.rng(60000 + i), { omega: 1 }).th; if (zOf(th)[1] > zOf(th)[0]) nT++; });
  facts.sds_bal_n = sel.length; facts.sds_bal_tref = nT;
  ok('one climb from each of 60 balanced fronts ends as the trefoil almost every time', sel.length === 60 && nT >= 55, [nT, sel.length]);
}
// the nearest hill decides: start the climber from random real objects instead of the round blob (front A); it ends on the kind of the explanation nearest its start
{
  const f = F[0], P = posterior(f.fr), rng = FL.rng(4242), n = 120; let agree = 0;
  for (let i = 0; i < n; i++) {
    const th0 = L13.shape(i % 2, rng), near = dist(th0, P.comps[0].m) < dist(th0, P.comps[1].m) ? 0 : 1;
    const th = L13.climb(f, FL.rng(82000 + i), { start: th0 }).th;
    if ((zOf(th)[0] > zOf(th)[1] ? 0 : 1) === near) agree++;
  }
  facts.sds_start_n = n; facts.sds_start_agree = agree;
  ok('started from a real object, the climber ends on the kind of the explanation nearest the start, every time', agree === n, [agree, n]);
}
// the climber ends where the expected SDS gradient (the gradient of the KL) is small
{
  const f = F[0], vs = L13.views(), cond = L13.viewModel(f), rng = FL.rng(77), E = Array.from({ length: 24 }, () => Array.from({ length: NV }, () => FL.randn(rng)));
  const expGrad = th => {              // th in theta units; average over all views, all levels, 24 fixed noise draws, weight s^2
    const thp = th.map(v => v / SC), g = new Array(D).fill(0); let cnt = 0;
    for (let vi = 0; vi < NVIEW; vi++) for (let ti = 0; ti < NT; ti++) {
      const t = 0.02 + 0.96 * ti / (NT - 1), a = aT(t), s = sT(t), A = vs[vi].A;
      for (const eps of E) {
        const x = Array.from({ length: NV }, (_, i) => { let r = 0; for (let j = 0; j < D; j++) r += A[i * D + j] * thp[j]; return r; });
        const z = Float64Array.from(x, (v, i) => a * v + s * eps[i]), o = new Float64Array(NV); L13.epsHat(cond[vi][ti], NV, z, a, s, o);
        for (let j = 0; j < D; j++) { let gs = 0; for (let i = 0; i < NV; i++) gs += (o[i] - eps[i]) * A[i * D + j]; g[j] += s * s * gs; }
        cnt++;
      }
    }
    return Math.hypot(...g.map(v => v / cnt));
  };
  const g0 = expGrad(new Array(D).fill(0)); let gEnd = 0;
  for (let i = 0; i < 3; i++) gEnd += expGrad(Array.from(L13.climb(f, FL.rng(40000 + i), { omega: 1 }).th)) / 3;
  facts.grad_start = g0; facts.grad_end = gEnd; facts.grad_ratio = gEnd / g0;
  ok('the expected SDS gradient is large at the round start and small where the climber ends', gEnd < 0.3 * g0, [g0, gEnd]);
}

/* ── F. four views drawn independently or jointly; a fresh draw every time you ask ── */
{
  for (const f of [F[0], F[2]]) {
    const w = f.post.w[0], R = 8000, rng = FL.rng(31); let agree = 0, joint = 0, flips = 0, prev = null;
    for (let i = 0; i < R; i++) {
      const ts = L13.tiles(f, rng, false), k0 = L13.kind(ts[0]); if (ts.every(t => L13.kind(t) === k0)) agree++;
      const tj = L13.tiles(f, rng, true); if (tj.every(t => t === tj[0])) joint++;
    }
    const rng2 = FL.rng(8); for (let i = 0; i < R; i++) { const k = zOf(SH.sampleMixture(f.post.comp, rng2, 1)[0]); const kk = k[0] > k[1] ? 0 : 1; if (prev !== null && kk !== prev) flips++; prev = kk; }
    const pa = w ** 4 + (1 - w) ** 4, pf = 2 * w * (1 - w);
    ok('front ' + f.id + ': four independent views agree on the kind with probability w^4 + (1-w)^4', Math.abs(agree / R - pa) < 4 * Math.sqrt(pa * (1 - pa) / R), [agree / R, pa]);
    ok('front ' + f.id + ': four views drawn jointly are one object', joint === R);
    ok('front ' + f.id + ': consecutive draws change kind with probability 2w(1-w)', Math.abs(flips / (R - 1) - pf) < 0.02, [flips / (R - 1), pf]);
    facts['tile_closed_' + f.id] = 100 * pa; facts['tile_meas_' + f.id] = 100 * agree / R; facts['flip_closed_' + f.id] = 100 * pf; facts['flip_meas_' + f.id] = 100 * flips / (R - 1);
  }
  facts.tile_k2 = 100 * 2 * 0.5 ** 2; facts.tile_k3 = 100 * 2 * 0.5 ** 3; facts.tile_k4 = 100 * 2 * 0.5 ** 4;
  // a draw is plausible, not true: how often is its kind the true kind, on the balanced fronts?  (kind of the true object vs the draw's kind)
  facts.right_draw = 100 * BAL.reduce((s, it) => s + (it.c === 0 ? it.P.comps[0].w : it.P.comps[1].w), 0) / BAL.length;
  facts.right_mode = 100 * BAL.filter(it => (it.P.comps[0].w >= 0.5 ? 0 : 1) === it.c).length / BAL.length;
}
/* ── a frozen draw goes stale: the object turns, the back drawn at frame 0 stays where it was (even a perfect back) ── */
{
  const f = F[0];
  for (const deg of [10, 20]) {
    const d = deg * Math.PI / 180; let s2 = 0;
    for (const p of PROBES) s2 += (radius(f.th, p) - radius(f.th, p - d)) ** 2;
    facts['stale_' + deg] = CM * Math.sqrt(s2 / PROBES.length);
  }
  ok('a perfect back left in place goes stale as the object turns', facts.stale_10 > 5 && facts.stale_20 > 1.8 * facts.stale_10 * 0.9, [facts.stale_10, facts.stale_20]);
}
/* ── the checkpoint: a back that is 0.8 with probability 0.3 and 1.2 with probability 0.7 ── */
{
  const pts = [[0.8, 0.3], [1.2, 0.7]], mean = pts.reduce((s, [v, p]) => s + v * p, 0), mse = pts.reduce((s, [v, p]) => s + p * (v - mean) ** 2, 0);
  let mseDraw = 0; for (const [a, p] of pts) for (const [b, q] of pts) mseDraw += p * q * (a - b) ** 2 / 1;   // E|truth - draw|^2 with both independent
  facts.ck_mean = mean; facts.ck_mse = mse; facts.ck_mse_draw = mseDraw; facts.ck_rms = Math.sqrt(mse); facts.ck_rms_draw = Math.sqrt(mseDraw);
  facts.ck_flip = 2 * 0.3 * 0.7; facts.ck_gap = Math.min(...pts.map(([v]) => Math.abs(v - mean)));
  ok('checkpoint: the draw errs by twice the variance', close(mseDraw, 2 * mse, 1e-12), [mseDraw, mse]);
}

/* ── facts in the units the page prints ── */
facts.A_wt = 100 - facts.A_w; facts.grad_ratio_pct = 100 * facts.grad_ratio; facts.tile_joint = 100;
facts.rev_spread_gap = 100 * Math.max(Math.abs(1 - facts.rev_spread_A), Math.abs(1 - facts.rev_spread_C));
ok('the sampler\'s spread is within 3% of the closed form\'s', facts.rev_spread_gap < 3, facts.rev_spread_gap);
{
  const cf = SH.sampleMixture(F[2].post.comp, FL.rng(6), 4000); facts.cf_valid_C = 100 * cf.filter(t => hyb(t) <= 0.5).length / cf.length;
  // residual of a posterior draw on the readings (it fits the front like the explanations do)
  const rng = FL.rng(9); let q = 0; const R = BAL.length * 4;
  BAL.forEach(it => { for (let k = 0; k < 4; k++) { const th = SH.sampleMixture([0, 1].map(c => ({ w: it.P.comps[c].w, mean: Float64Array.from(it.P.comps[c].m), cov: Float64Array.from([].concat(...it.P.comps[c].S)) })), rng, 1)[0], A = design(it.fr.ang), pr = mv(A, Array.from(th)); q += it.fr.r.reduce((s2, v, i) => s2 + (v - 1 - pr[i]) ** 2, 0) / it.fr.r.length; } });
  facts.res_draw_bal = CM * Math.sqrt(q / R);
}

/* ── G. the widget, driven into every state quoted in "What to try", and its readouts recomputed from the answers it drew ── */
const PAGE = path.join(DIR, '13_sampling_the_unseen.html');
if (fs.existsSync(PAGE)) {
  const page = loadPage(PAGE, { dpr: 1 });
  ok('page loads cleanly', page.problems.length === 0, page.problems.join(' | '));
  const num = id => page.num(id), txt = id => page.text(id);
  const pairRms = th => { let s2 = 0, n = 0; for (let i = 0; i < th.length; i++) for (let j = 0; j < i; j++) { s2 += dist(th[i], th[j]) ** 2; n++; } return Math.sqrt(s2 / n); };
  const setState = (front, mode, n, om, batch) => { page.set('w13-front', front); page.set('w13-mode', mode); page.set('w13-n', n); page.set('w13-om', om === undefined ? 0 : om); };
  const OMS = [1, 3, 10, 30, 100], FI = { A: 0, B: 1, C: 2, D: 3 };
  // check the widget's readouts against numbers recomputed here from the answers (own distance, own scores, own pair statistics)
  function check(label, front, mode, n, omIdx) {
    setState(front, mode, n, omIdx);
    const f = F[FI[front]], res = L13.run(f, mode, n, { batch: 0, omega: OMS[omIdx || 0] }), th = res.th;
    const kinds = th.map(t => (zOf(t)[0] > zOf(t)[1] ? 0 : 1)), out = {}, na = th.length;
    out.oval = 100 * kinds.filter(k => k === 0).length / na;
    out.h = med(th.map(hyb)); out.valid = 100 * th.filter(t => hyb(t) <= 0.5).length / na;
    out.err = Math.sqrt(th.reduce((s2, t) => s2 + dist(t, f.th) ** 2, 0) / na);
    out.diff = na > 1 ? pairRms(th) : NaN; out.flip = kinds.slice(1).filter((k, i) => k !== kinds[i]).length;
    if (mode !== 'mean' && mode !== 'views') {
      ok(label + ': ovals', close(num('w13-m-oval'), out.oval, 0.5), [num('w13-m-oval'), out.oval]);
      ok(label + ': kind changes', num('w13-m-flip') === out.flip, [num('w13-m-flip'), out.flip]);
      ok(label + ': spread of answers', na < 2 || close(num('w13-m-diff'), out.diff, 0.06), [num('w13-m-diff'), out.diff]);
      ok(label + ': h median', close(num('w13-m-h'), out.h, 0.006), [num('w13-m-h'), out.h]);
    }
    if (mode !== 'views') {
      ok(label + ': valid', close(num('w13-m-valid'), out.valid, 0.5), [num('w13-m-valid'), out.valid]);
      ok(label + ': error against the truth', close(num('w13-m-err'), out.err, 0.06), [num('w13-m-err'), out.err]);
    } else {
      const ag = 100 * res.tiles.filter(ts => ts.every(t => (zOf(t)[0] > zOf(t)[1] ? 0 : 1) === (zOf(ts[0])[0] > zOf(ts[0])[1] ? 0 : 1))).length / n;
      ok(label + ': views agree', close(num('w13-m-agree'), ag, 0.5), [num('w13-m-agree'), ag]); out.agree = ag;
    }
    ok(label + ': h of the average', close(num('w13-m-avg'), hyb(posterior(f.fr).mean), 0.006), [num('w13-m-avg')]);
    return out;
  }
  let o = check('default (front A, draws)', 'A', 'sample', 24, 0);
  facts.w_oval_sample = o.oval; facts.w_valid_sample = o.valid; facts.w_diff_sample = o.diff; facts.w_flip_sample = o.flip; facts.w_err_sample = o.err;
  o = check('48 draws, front A', 'A', 'sample', 48, 0); facts.w_diff_48 = o.diff;
  ok('more draws do not average out: the spread of the answers stays near its 24-draw value', Math.abs(facts.w_diff_48 - facts.w_diff_sample) < 3, [facts.w_diff_48, facts.w_diff_sample]);
  o = check('the average, front A', 'A', 'mean', 24, 0); facts.w_err_mean = o.err;
  ok('the average on front A has the h and error of §1', close(num('w13-m-avg'), facts.A_h, 0.006) && close(o.err, facts.A_err_mean, 1e-6), [o.err, facts.A_err_mean]);
  o = check('reverse diffusion, front A', 'A', 'reverse', 24, 0); facts.w_rev_oval = o.oval;
  o = check('score climbing, front A', 'A', 'climb', 24, 0); facts.w_climb_oval = o.oval; facts.w_climb_diff = o.diff;
  ok('climbing on front A gives no oval at any guidance', [0, 1, 2, 3, 4].every(i => { setState('A', 'climb', 24, i); return num('w13-m-oval') === 0; }));
  o = check('draws, front C', 'C', 'sample', 24, 0); facts.w_C_oval = o.oval;
  for (const i of [0, 1, 4]) { o = check('climbing, front C, omega ' + OMS[i], 'C', 'climb', 24, i); facts['w_C_valid_' + OMS[i]] = o.valid; }
  o = check('views drawn independently, front A', 'A', 'views', 24, 0); facts.w_agree = o.agree;
  for (const m of ['mean', 'sample', 'reverse', 'climb']) { o = check('front D, ' + m, 'D', m, 24, 0); if (m === 'mean') { facts.w_D_h = num('w13-m-avg'); facts.w_D_err = o.err; } else ok('front D: every answer is a trefoil', num('w13-m-oval') === 0, num('w13-m-oval')); }
  ok('front D: the average is a valid object', facts.w_D_h < 0.5, facts.w_D_h);
  // "new draws" gives different answers; the slider changes the readouts; sizes
  setState('A', 'sample', 24, 0); const before = txt('w13-m-oval') + txt('w13-m-diff'); page.click('w13-more'); const after = txt('w13-m-oval') + txt('w13-m-diff');
  ok('new draws change the answers', before !== after, [before, after]);
  setState('A', 'sample', 1, 0); ok('one draw: no consecutive pair', txt('w13-m-flip') === '0 of 0', txt('w13-m-flip'));
  ok('widget ran without errors', page.problems.length === 0, page.problems.join(' | '));
}

console.error(fails ? fails + ' check(s) FAILED' : 'all checks passed');
console.log(JSON.stringify({ facts }));
process.exit(fails ? 1 : 0);
