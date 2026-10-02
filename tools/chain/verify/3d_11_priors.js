#!/usr/bin/env node
/* Oracle for 3D lesson 11, "When the views run out: learning across scenes".
 *
 * Independent pieces (nothing below calls L11.* or SH.posterior for a number the prose quotes; those are only compared against):
 *   (a) the toy is rebuilt from the lesson's own formulas: design rows (cos k phi, sin k phi), 9 readings over |phi - alpha| <= 50 deg;
 *   (b) singular values and the null vector by one-sided (Hestenes) Jacobi on A itself, not on A'A;
 *   (c) the posterior as a STACKED least-squares problem solved by modified Gram-Schmidt QR:  min |A theta - r|^2/sigma^2 + |L^-1 (theta - mu)|^2
 *       with Lam = L L' (Cholesky), covariance S = R^-1 R^-T, instead of P = Lam^-1 + A'A/sigma^2;
 *   (d) the learned prior re-estimated from its definition (400 objects of the world, seed 99), calibration by a separate loop over 1000 objects;
 *   (e) the amortised map by ridge normal equations; the closed-form scale numbers; the early-stopping identity by running gradient descent;
 *   (f) what an optimiser leaves in the unseen directions: plain gradient descent keeps the null component of its starting point exactly, Adam does not (toy), and Adam moves
 *       every node of lesson 9's three-camera field, the faintest-gradient node as far as the median one (the field itself is lesson 9's engine, which lesson 9's oracle checks
 *       against a second implementation of the loop).
 * Then the page's widget is driven into each state quoted in "What to try" and must print what (c)-(d) compute.
 * Prints {"facts": {...}} as its last stdout line.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '../../../all_lessons');
const DIR = fs.existsSync(path.join(ROOT, 'computer_vision_3d_new')) ? path.join(ROOT, 'computer_vision_3d_new') : path.join(ROOT, 'computer_vision_3d');
const FL = require(path.join(DIR, 'flatland.js'));
const L11 = require(path.join(DIR, 'l11_priors.js'));
const N9 = require(path.join(DIR, 'l09_nerf.js'));
const SH = FL.shape;
const { loadPage } = require('../dom_probe.js');

let fails = 0;
const facts = {};
function ok(name, cond, extra) { if (!cond) { fails++; console.error('FAIL', name, extra === undefined ? '' : extra); } }
const close = (a, b, tol) => Math.abs(a - b) <= (tol === undefined ? 1e-9 : tol);
const PI = Math.PI, D = 10, HALF = 50 * PI / 180, NPIX = 9, CM = 115, NCAL = 1000, SEED_CAL = 2024;
const wrap = a => { while (a > PI) a -= 2 * PI; while (a < -PI) a += 2 * PI; return a; };

/* ───────── the toy, rebuilt ───────── */
const row = phi => { const r = []; for (let k = 1; k <= 5; k++) r.push(Math.cos(k * phi), Math.sin(k * phi)); return r; };
const radiusOf = (th, phi) => 1 + row(phi).reduce((s, h, i) => s + h * th[i], 0);
const PROBES = Array.from({ length: 72 }, (_, i) => -PI + 2 * PI * (i + 0.5) / 72);
const alphasOf = (V, p) => Array.from({ length: V }, (_, k) => p === 'around' ? 2 * PI * k / V : k * PI / 6);
const anglesOf = al => { const out = []; for (const a of al) for (let j = 0; j < NPIX; j++) out.push(a - HALF + 2 * HALF * j / (NPIX - 1)); return out; };
const isSeen = (phi, al) => al.some(a => Math.abs(wrap(phi - a)) <= HALF + 1e-9);
const designOf = phis => phis.map(row);                          // array of rows

/* small dense linear algebra on arrays of arrays */
const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);
const matvec = (M, v) => M.map(r => dot(r, v));
function cholesky(M) {
  const n = M.length, L = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) for (let j = 0; j <= i; j++) {
    let s = M[i][j]; for (let k = 0; k < j; k++) s -= L[i][k] * L[j][k];
    L[i][j] = i === j ? Math.sqrt(s) : s / L[j][j];
  }
  return L;
}
function lowerInverse(L) {                                        // inverse of a lower-triangular matrix
  const n = L.length, X = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let c = 0; c < n; c++) for (let i = c; i < n; i++) {
    let s = i === c ? 1 : 0; for (let k = c; k < i; k++) s -= L[i][k] * X[k][c];
    X[i][c] = s / L[i][i];
  }
  return X;
}
/* thin QR by modified Gram-Schmidt: M = Q R, M is rows x n */
function qr(M) {
  const m = M.length, n = M[0].length, Q = M.map(r => r.slice()), R = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let j = 0; j < n; j++) {
    for (let k = 0; k < j; k++) { let s = 0; for (let i = 0; i < m; i++) s += Q[i][k] * Q[i][j]; R[k][j] = s; for (let i = 0; i < m; i++) Q[i][j] -= s * Q[i][k]; }
    let nr = 0; for (let i = 0; i < m; i++) nr += Q[i][j] * Q[i][j]; nr = Math.sqrt(nr); R[j][j] = nr;
    for (let i = 0; i < m; i++) Q[i][j] /= nr;
  }
  return { Q, R };
}
function backSolve(R, b) { const n = R.length, x = new Array(n).fill(0); for (let i = n - 1; i >= 0; i--) { let s = b[i]; for (let j = i + 1; j < n; j++) s -= R[i][j] * x[j]; x[i] = s / R[i][i]; } return x; }
function upperInverse(R) { const n = R.length, X = Array.from({ length: n }, () => new Array(n).fill(0)); for (let c = 0; c < n; c++) { const e = new Array(n).fill(0); e[c] = 1; const x = backSolve(R, e); for (let i = 0; i < n; i++) X[i][c] = x[i]; } return X; }

/* one-sided Jacobi SVD of an m x n matrix (array of rows): singular values and right singular vectors, descending */
function svd(A) {
  const m = A.length, n = A[0].length, U = A.map(r => r.slice()), V = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => i === j ? 1 : 0));
  for (let sweep = 0; sweep < 80; sweep++) {
    let rot = 0;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) {
      let al = 0, be = 0, ga = 0;
      for (let i = 0; i < m; i++) { al += U[i][p] * U[i][p]; be += U[i][q] * U[i][q]; ga += U[i][p] * U[i][q]; }
      if (Math.abs(ga) <= 1e-17 * Math.sqrt(al * be) || Math.abs(ga) < 1e-300) continue;
      rot++;
      const z = (be - al) / (2 * ga), t = Math.sign(z || 1) / (Math.abs(z) + Math.sqrt(1 + z * z)), c = 1 / Math.sqrt(1 + t * t), s = c * t;
      for (let i = 0; i < m; i++) { const up = U[i][p], uq = U[i][q]; U[i][p] = c * up - s * uq; U[i][q] = s * up + c * uq; }
      for (let i = 0; i < n; i++) { const vp = V[i][p], vq = V[i][q]; V[i][p] = c * vp - s * vq; V[i][q] = s * vp + c * vq; }
    }
    if (!rot) break;
  }
  const sv = []; for (let j = 0; j < n; j++) { let s = 0; for (let i = 0; i < m; i++) s += U[i][j] * U[i][j]; sv.push(Math.sqrt(s)); }
  const idx = sv.map((_, j) => j).sort((a, b) => sv[b] - sv[a]);
  return { s: idx.map(j => sv[j]), v: idx.map(j => V.map(r => r[j])), u: idx.map(j => U.map(r => r[j])) };
}

/* ───────── priors, rebuilt from their definitions ───────── */
const outer = (a, b) => a.map(x => b.map(y => x * y));
function learnedPrior(n, seed) {
  const rng = FL.rng(seed), X = [];
  for (let t = 0; t < n; t++) X.push(Array.from(SH.sampleFamily(rng)));
  const mu = new Array(D).fill(0); X.forEach(x => x.forEach((v, i) => mu[i] += v / n));
  const Lam = Array.from({ length: D }, () => new Array(D).fill(0));
  X.forEach(x => { for (let i = 0; i < D; i++) for (let j = 0; j < D; j++) Lam[i][j] += (x[i] - mu[i]) * (x[j] - mu[j]) / (n - 1); });
  for (let i = 0; i < D; i++) Lam[i][i] += 1e-6;
  return { mu, Lam };
}
const diagPrior = sds => ({ mu: new Array(D).fill(0), Lam: Array.from({ length: D }, (_, i) => Array.from({ length: D }, (_, j) => i === j ? sds[i] * sds[i] : 0)) });
const PRIORS = { none: diagPrior(new Array(D).fill(1)), smooth: diagPrior(Array.from({ length: D }, (_, i) => 0.12 / (Math.floor(i / 2) + 1))), learned: learnedPrior(400, 99) };

/* the posterior as a stacked least-squares problem; returns a function r -> mean, the covariance S, and the pointwise std at the probes */
function posteriorQR(phis, sigma, prior) {
  const A = designOf(phis), L = cholesky(prior.Lam), Li = lowerInverse(L);
  const M = A.map(r => r.map(x => x / sigma)).concat(Li);       // rows: A/sigma ; L^-1
  const { Q, R } = qr(M);
  const Rinv = upperInverse(R), S = Array.from({ length: D }, (_, i) => Array.from({ length: D }, (_, j) => dot(Rinv[i], Rinv[j])));
  const Limu = matvec(Li, prior.mu), m = A.length;
  const solve = r => {
    const b = r.map(x => x / sigma).concat(Limu), Qtb = new Array(D).fill(0);
    for (let j = 0; j < D; j++) for (let i = 0; i < b.length; i++) Qtb[j] += Q[i][j] * b[i];
    return backSolve(R, Qtb);
  };
  const std = PROBES.map(p => { const h = row(p); return Math.sqrt(Math.max(dot(h, matvec(S, h)), 0)); });
  return { solve, S, std, A, m };
}
/* independent world and readings; same random stream layout as the lesson (object first, then the noise on each reading) */
const F4 = (() => { const f = new Array(D).fill(0); f[2] = -0.09; f[6] = -0.12; f[7] = 0.05; f[8] = 0.07; return f; })();
function worldObject(rng, ood) {
  const th = Array.from(SH.sampleFamily(rng));
  if (ood) { const z = 1 + 0.25 * FL.randn(rng); for (let i = 0; i < D; i++) th[i] += z * F4[i]; }
  return th;
}
const readingsOf = (A, th, sigma, rng) => A.map(r => dot(r, th) + sigma * FL.randn(rng));
const unseenIdx = al => PROBES.map((p, j) => isSeen(p, al) ? -1 : j).filter(j => j >= 0);

/* calibration over N objects: mean unseen RMSE (R units), claimed sd, 2-sigma coverage, plus the seen-arc residual in units of sigma */
function calibrate(al, sigma, prior, ood, N, seed, mapFn) {
  const phis = anglesOf(al), P = posteriorQR(phis, sigma, prior), un = unseenIdx(al), rng = FL.rng(seed), H = PROBES.map(row);
  const out = { rmse: 0, cov: 0, claimed: un.reduce((s, j) => s + P.std[j], 0) / (un.length || 1), nUnseen: un.length, resid: 0, rmseCircle: 0 };
  for (let t = 0; t < N; t++) {
    const th = worldObject(rng, ood), r = readingsOf(P.A, th, sigma, rng), mean = mapFn ? mapFn(r) : P.solve(r);
    let se = 0, c = 0, sc = 0; for (const j of un) { const e = dot(H[j], mean) - dot(H[j], th); se += e * e; if (Math.abs(e) <= 2 * P.std[j]) c++; sc += dot(H[j], th) ** 2; }
    if (un.length) { out.rmse += Math.sqrt(se / un.length) / N; out.cov += c / un.length / N; out.rmseCircle += Math.sqrt(sc / un.length) / N; }
    let rs = 0; for (let i = 0; i < r.length; i++) rs += (r[i] - dot(P.A[i], mean)) ** 2; out.resid += Math.sqrt(rs / r.length) / sigma / N;
  }
  return out;
}

/* ───────── 0. the engine and the independent rebuild agree ───────── */
{
  const pri = L11.makePriors();
  for (const k of ['none', 'smooth', 'learned']) {
    let w = 0; for (let i = 0; i < D; i++) for (let j = 0; j < D; j++) w = Math.max(w, Math.abs(pri[k].Lam[i * D + j] - PRIORS[k].Lam[i][j]));
    ok('prior ' + k + ' rebuilt from its definition', w < 1e-12, w);
  }
  const rng = FL.rng(5);
  for (const [V, p] of [[1, 'walk'], [3, 'walk'], [2, 'around']]) for (const k of ['none', 'smooth', 'learned']) {
    const al = alphasOf(V, p), phis = anglesOf(al), eng = L11.fit(L11.angles(L11.alphas(V, p)), 0.01, pri[k]), mine = posteriorQR(phis, 0.01, PRIORS[k]);
    const th = worldObject(rng, false), r = readingsOf(mine.A, th, 0.01, rng), a = L11.mean(eng, r), b = mine.solve(r);
    let w = 0; for (let i = 0; i < D; i++) w = Math.max(w, Math.abs(a[i] - b[i]) / (1 + Math.abs(b[i])));
    ok(`engine posterior mean == stacked least squares (${V} ${p} ${k})`, w < 1e-6, w);
    const sd = L11.std(eng); let ws = 0; for (let j = 0; j < 72; j++) ws = Math.max(ws, Math.abs(sd[j] - mine.std[j]) / (1e-9 + mine.std[j]));
    ok(`engine posterior sd == R^-1 R^-T (${V} ${p} ${k})`, ws < 1e-6, ws);
  }
}

/* ───────── 1. the count, the null space, the twin ───────── */
facts.field_unk = 40 * 40 * 4; facts.field_obs = 3 * 64 * 3; facts.field_gap = facts.field_unk - facts.field_obs;
const SIG = 0.01;
const sv = {};
for (let V = 1; V <= 4; V++) {
  const al = alphasOf(V, 'walk'), A = designOf(anglesOf(al)), r = svd(A);
  sv[V] = r;
  facts['nd' + V] = r.s.filter(s => s < SIG).length;
  facts['un' + V] = 100 * unseenIdx(al).length / 72;
}
facts.sv1_7 = sv[1].s[6]; facts.sv1_1 = sv[1].s[0];
ok('one view: 9 readings, rank 9 (null space of dimension 1)', anglesOf(alphasOf(1, 'walk')).length === 9 && sv[1].s[9] < 1e-12 && sv[1].s[8] > 1e-5, sv[1].s.slice(7));
ok('null directions fall with each camera', facts.nd1 > facts.nd2 && facts.nd2 > facts.nd3 && facts.nd3 > facts.nd4 && facts.nd4 === 0, [facts.nd1, facts.nd2, facts.nd3, facts.nd4]);
ok('the back stays unseen with four cameras on the walk', facts.un4 > 40, facts.un4);
// the twin: statue + 0.2 v, v the unit null vector of the 9 x 10 matrix
{
  const al = alphasOf(1, 'walk'), phis = anglesOf(al), A = designOf(phis), v = sv[1].v[9], st = Array.from(SH.statueTheta()), t = 0.2;
  ok('null vector is a unit vector', close(Math.sqrt(dot(v, v)), 1, 1e-12));
  ok('A v = 0', Math.max(...matvec(A, v).map(Math.abs)) < 1e-12, Math.max(...matvec(A, v).map(Math.abs)));
  const twin = st.map((x, i) => x + t * v[i]);
  const dRead = Math.max(...phis.map(p => Math.abs(radiusOf(twin, p) - radiusOf(st, p))));
  ok('twin: the nine readings are identical to 1e-12', dRead < 1e-12, dRead);
  facts.twin_read_exp = -Math.log10(Math.max(dRead, 1e-300));
  let dUn = 0, dSeen = 0; PROBES.forEach(p => { const d = Math.abs(radiusOf(twin, p) - radiusOf(st, p)); if (isSeen(p, al)) dSeen = Math.max(dSeen, d); else dUn = Math.max(dUn, d); });
  facts.twin_cm = dUn * CM; ok('twin: differs on the unseen side by tens of cm', dUn * CM > 20 && dUn * CM < 60, dUn * CM);
  ok('twin: the seen probes (inside the arc) move by at most a couple of cm', dSeen * CM < 3, dSeen * CM);
  // the penalties (theta - mu)' Lam^-1 (theta - mu) of the statue and of its twin under each prior
  const pen = (th, pr) => { const L = cholesky(pr.Lam), Li = lowerInverse(L), z = matvec(Li, th.map((x, i) => x - pr.mu[i])); return dot(z, z); };
  for (const [k, c] of [['n', 'none'], ['s', 'smooth'], ['l', 'learned']]) { facts['pen_' + c + '_s'] = pen(st, PRIORS[c]); facts['pen_' + c + '_t'] = pen(twin, PRIORS[c]); }
  ok('learned prior ranks the statue far above its twin', facts.pen_learned_t > 50 * facts.pen_learned_s, [facts.pen_learned_s, facts.pen_learned_t]);
  ok('smooth prior ranks the statue above its twin', facts.pen_smooth_t > facts.pen_smooth_s);
  // data-only misfit of the twin = 0; the null-space identity S^-1 v = Lam^-1 v
  const L = cholesky(PRIORS.learned.Lam), Li = lowerInverse(L), P = posteriorQR(phis, SIG, PRIORS.learned);
  const Sinv = Array.from({ length: D }, (_, i) => Array.from({ length: D }, (_, j) => { let s = 0; for (let r = 0; r < D; r++) s += Li[r][i] * Li[r][j]; for (const a of P.A) s += a[i] * a[j] / (SIG * SIG); return s; }));
  const Sinv_v = matvec(Sinv, v), Linv_v = matvec(Array.from({ length: D }, (_, i) => Array.from({ length: D }, (_, j) => { let s = 0; for (let r = 0; r < D; r++) s += Li[r][i] * Li[r][j]; return s; })), v);
  ok('S^-1 v = Lam^-1 v on the null space', Math.max(...Sinv_v.map((x, i) => Math.abs(x - Linv_v[i]))) < 1e-6 * Math.max(...Linv_v.map(Math.abs)), Math.max(...Sinv_v.map((x, i) => Math.abs(x - Linv_v[i]))));
}

/* ───────── 2. the tables: every prior, every camera count, in family ───────── */
const cal = {};
for (const path_ of ['walk', 'around']) for (let V = 1; V <= 4; V++) for (const k of ['none', 'smooth', 'learned']) {
  const c = calibrate(alphasOf(V, path_), SIG, PRIORS[k], false, NCAL, SEED_CAL);
  cal[`${path_}${V}${k}`] = c;
}
const g = (p, V, k) => cal[`${p}${V}${k}`];
facts.e_none1 = g('walk', 1, 'none').rmse * CM; facts.bar_none1 = g('walk', 1, 'none').claimed * CM; facts.cov_none1 = 100 * g('walk', 1, 'none').cov;
facts.e_smooth1 = g('walk', 1, 'smooth').rmse * CM; facts.bar_smooth1 = g('walk', 1, 'smooth').claimed * CM; facts.cov_smooth1 = 100 * g('walk', 1, 'smooth').cov;
facts.e_learn1 = g('walk', 1, 'learned').rmse * CM; facts.bar_learn1 = g('walk', 1, 'learned').claimed * CM; facts.cov_learn1 = 100 * g('walk', 1, 'learned').cov;
facts.e_circle1 = g('walk', 1, 'none').rmseCircle * CM;
facts.e_none4 = g('walk', 4, 'none').rmse * CM; facts.e_around2 = g('around', 2, 'none').rmse * CM;
facts.e_smooth4 = g('walk', 4, 'smooth').rmse * CM; facts.bar_smooth4 = g('walk', 4, 'smooth').claimed * CM; facts.cov_smooth4 = 100 * g('walk', 4, 'smooth').cov;
facts.e_learn4 = g('walk', 4, 'learned').rmse * CM; facts.cov_learn4 = 100 * g('walk', 4, 'learned').cov;
facts.ratio_sl = facts.e_smooth1 / facts.e_learn1; facts.ratio_nc = facts.e_none1 / facts.e_circle1;
facts.un_around3 = 100 * unseenIdx(alphasOf(3, 'around')).length / 72;
facts.un_around4 = 100 * unseenIdx(alphasOf(4, 'around')).length / 72;
ok('four cameras all around leave nothing unread: a fully measured toy scene (Road not taken: 20 scenes x 4 positions = 80)', facts.un_around4 === 0 && facts.un_around3 > 0, [facts.un_around3, facts.un_around4]);
ok('no prior is worse than a plain circle', facts.e_none1 > facts.e_circle1, [facts.e_none1, facts.e_circle1]);
ok('learned < smooth < no prior (one camera)', facts.e_learn1 < facts.e_smooth1 && facts.e_smooth1 < facts.e_none1);
ok('learned prior is calibrated in family (93..97 %) and its bar equals its error (10 %)', facts.cov_learn1 > 93 && facts.cov_learn1 < 97 && close(facts.bar_learn1 / facts.e_learn1, 1, 0.1), [facts.cov_learn1, facts.bar_learn1, facts.e_learn1]);
ok('smooth prior: right at one camera, too confident at four', facts.cov_smooth1 > 93 && facts.cov_smooth4 < 85 && facts.bar_smooth4 < 0.75 * facts.e_smooth4, [facts.cov_smooth1, facts.cov_smooth4]);
ok('four cameras on the walk with no prior still leave a large error', facts.e_none4 > 20, facts.e_none4);
ok('two cameras round the object with no prior ~ one camera with the learned prior (within 15 %)', Math.abs(facts.e_around2 / facts.e_learn1 - 1) < 0.15, [facts.e_around2, facts.e_learn1]);
ok('claimed bar of the learned prior shrinks with cameras', g('walk', 4, 'learned').claimed < g('walk', 1, 'learned').claimed);
facts.bar_learn4 = g('walk', 4, 'learned').claimed * CM;
// spectrum of the learned covariance
{
  const ev = svd(PRIORS.learned.Lam).s;                         // symmetric PSD: singular values = eigenvalues
  facts.ev1 = ev[0]; facts.ev2 = ev[1]; facts.ev3 = ev[2];
  facts.ev_rest = ev.slice(3).reduce((a, b) => a + b, 0) / 7;
  facts.top3 = 100 * (ev[0] + ev[1] + ev[2]) / ev.reduce((a, b) => a + b, 0);
  facts.sd_weak_lo = Math.sqrt(ev[9]) * CM; facts.sd_weak_hi = Math.sqrt(ev[3]) * CM;
  ok('three big directions and seven small ones', ev[2] > 20 * ev[3], ev);
}
// the learned prior as a function of the number of training scenes (mean over 20 training stacks), one camera
{
  const al = alphasOf(1, 'walk');
  for (const n of [3, 5, 10, 20, 100, 400]) {
    let e = 0, c = 0; const T = 20;
    for (let j = 0; j < T; j++) { const r = calibrate(al, SIG, learnedPrior(n, 99 + 17 * j), false, NCAL, SEED_CAL); e += r.rmse * CM / T; c += 100 * r.cov / T; }
    facts['ns_e' + n] = e; facts['ns_c' + n] = c;
  }
  ok('more training scenes: smaller error, more honest bars', facts.ns_e5 > facts.ns_e20 && facts.ns_e20 > facts.ns_e100 && facts.ns_c5 < facts.ns_c20 && facts.ns_c20 < facts.ns_c100);
  ok('five scenes are no better than the smooth prior; twenty are far better', facts.ns_e5 > 0.9 * facts.e_smooth1 && facts.ns_e20 < 0.55 * facts.e_smooth1, [facts.ns_e5, facts.ns_e20, facts.e_smooth1]);
  ok('twenty scenes ~ two cameras round the object', Math.abs(facts.ns_e20 / facts.e_around2 - 1) < 0.1, [facts.ns_e20, facts.e_around2]);
}

/* ───────── 3. out of family ───────── */
{
  const al = alphasOf(1, 'walk');
  const ol = calibrate(al, SIG, PRIORS.learned, true, NCAL, SEED_CAL), os = calibrate(al, SIG, PRIORS.smooth, true, NCAL, SEED_CAL);
  const il = g('walk', 1, 'learned');
  facts.ood_e_learn = ol.rmse * CM; facts.ood_bar_learn = ol.claimed * CM; facts.ood_cov_learn = 100 * ol.cov;
  facts.ood_e_smooth = os.rmse * CM; facts.ood_bar_smooth = os.claimed * CM; facts.ood_cov_smooth = 100 * os.cov;
  facts.ood_ratio = ol.rmse / ol.claimed; facts.ood_ratio_s = os.rmse / os.claimed;
  facts.resid_in = il.resid; facts.resid_ood = ol.resid;
  ok('out of family: the learned prior is wildly over-confident', facts.ood_cov_learn < 50 && facts.ood_ratio > 3, [facts.ood_cov_learn, facts.ood_ratio]);
  ok('out of family: the smooth prior is less over-confident than the learned one', facts.ood_cov_smooth > facts.ood_cov_learn + 20 && facts.ood_ratio_s < facts.ood_ratio);
  ok('the bar does not move out of family', close(ol.claimed, il.claimed, 1e-12));
  ok('the photographs show a trace (residual rises) but it is small', facts.resid_ood > facts.resid_in && facts.resid_ood < 1.2, [facts.resid_in, facts.resid_ood]);
  // the same at four cameras
  const o4 = calibrate(alphasOf(4, 'walk'), SIG, PRIORS.learned, true, NCAL, SEED_CAL);
  facts.ood_cov_learn4 = 100 * o4.cov; facts.ood_e_learn4 = o4.rmse * CM;
  ok('out of family: more cameras on the walk do not cure it', facts.ood_cov_learn4 < 60, facts.ood_cov_learn4);
}

/* ───────── 4. early stopping is a prior: gradient descent from zero on the 9 x 10 system ───────── */
{
  const A = designOf(anglesOf(alphasOf(1, 'walk'))), S = sv[1], eta = 1 / (S.s[0] * S.s[0]), th = new Array(D).fill(0), th0 = Array.from(SH.statueTheta()), r = matvec(A, th0);
  for (let t = 0; t < 100; t++) { const res = matvec(A, th).map((x, i) => x - r[i]); for (let j = 0; j < D; j++) { let gj = 0; for (let i = 0; i < A.length; i++) gj += A[i][j] * res[i]; th[j] -= eta * gj; } }
  const j = 6, vj = S.v[j], uj = S.u[j], sj = S.s[j];
  const coef = dot(vj, th), ls = dot(uj, r) / (sj * sj);          // u_j is the (unnormalised) left vector: |u_j| = s_j
  facts.es_frac = 100 * coef / ls;
  ok('gradient descent along direction 7 moves 1-(1-eta s^2)^t of the way', close(facts.es_frac / 100, 1 - Math.pow(1 - eta * sj * sj, 100), 1e-9), [facts.es_frac, 100 * (1 - Math.pow(1 - eta * sj * sj, 100))]);
  ok('after 100 steps the seventh direction has barely moved', facts.es_frac < 1.5, facts.es_frac);
  facts.es_s7 = sj;
}


/* ───────── 4b. what the optimiser leaves in the unseen directions ───────── */
{
  // (toy) plain gradient descent from a random start theta0 on the 9 x 10 system: theta_t - theta0 is a sum of gradients A'(A theta - r)/sigma^2, all in the row space of A,
  // so the component along the null vector v never changes; Adam divides each coordinate's step by its own gradient scale, which leaves the row space
  const A = designOf(anglesOf(alphasOf(1, 'walk'))), v = sv[1].v[9], r = matvec(A, Array.from(SH.statueTheta()));
  const rng0 = FL.rng(7), th0 = Array.from({ length: D }, () => 0.3 * FL.randn(rng0)), grad = th => { const res = matvec(A, th).map((x, i) => x - r[i]); return Array.from({ length: D }, (_, j) => A.reduce((s, a, i) => s + a[j] * res[i], 0)); };
  let th = th0.slice(); const eta = 1 / (sv[1].s[0] * sv[1].s[0]);
  for (let k = 0; k < 3000; k++) { const g = grad(th); th = th.map((x, j) => x - eta * g[j]); }
  facts.gd_null_drift = Math.abs(dot(v, th) - dot(v, th0));
  ok('plain gradient descent keeps the null component of its starting point (to 1e-12)', facts.gd_null_drift < 1e-12, facts.gd_null_drift);
  const worst = x => Math.max(...matvec(A, x).map((y, i) => Math.abs(y - r[i])));
  ok('and it did fit the readings (largest reading error falls below 3 % of the start\'s)', worst(th) < 0.03 * worst(th0), [worst(th0), worst(th)]);
  let a = th0.slice(), m = new Array(D).fill(0), vv = new Array(D).fill(0);
  for (let k = 1; k <= 3000; k++) { const g = grad(a), c1 = 1 - Math.pow(0.9, k), c2 = 1 - Math.pow(0.999, k); a = a.map((x, j) => { m[j] = 0.9 * m[j] + 0.1 * g[j]; vv[j] = 0.999 * vv[j] + 0.001 * g[j] * g[j]; return x - 0.01 * (m[j] / c1) / (Math.sqrt(vv[j] / c2) + 1e-8); }); }
  facts.adam_null_drift = Math.abs(dot(v, a) - dot(v, th0));
  ok('Adam on the same system does not keep the null component', facts.adam_null_drift > 1e-3, facts.adam_null_drift);
}
{
  // (field) lesson 9's three-camera fit, 150 steps: how far each node moves, and how faint its gradient ever was
  const S = N9.start(3, 40, false), NN = 1600, peak = new Float64Array(NN);
  for (let t = 0; t < 150; t++) { S.F.step(S.views, { lr: N9.LR, jitter: true, seed: 3 }); for (let k = 0; k < NN; k++) peak[k] = Math.max(peak[k], Math.abs(S.F.gS[k])); }
  let moved = 0; const dens = new Float64Array(NN);
  for (let k = 0; k < NN; k++) {
    dens[k] = Math.abs(S.F.s[k] - N9.S0);
    if (dens[k] > 0.05 || Math.abs(S.F.c[3 * k]) > 0.05 || Math.abs(S.F.c[3 * k + 1]) > 0.05 || Math.abs(S.F.c[3 * k + 2]) > 0.05) moved++;
  }
  const order = Array.from({ length: NN }, (_, k) => k).sort((p, q) => peak[p] - peak[q]), sortedDens = Array.from(dens).sort((p, q) => p - q);
  const faint = order[0], medPeak = peak[order[NN >> 1]];
  facts.adam_moved = moved; facts.adam_ratio = medPeak / peak[faint]; facts.adam_faint = dens[faint]; facts.adam_med = (sortedDens[NN / 2 - 1] + sortedDens[NN / 2]) / 2;
  ok('Adam moves every node of the three-camera field (no node keeps its starting values)', moved === NN, moved);
  ok('the faintest gradient is a thousandth of the median one, and its node moves at least as far as the median node', facts.adam_ratio > 500 && facts.adam_faint > facts.adam_med, [facts.adam_ratio, facts.adam_faint, facts.adam_med]);
  ok('lesson 9\'s count: 576 photographed numbers, 6400 unknowns', S.imgs.length === 3 && 3 * 64 * 3 === facts.field_obs && NN * 4 === facts.field_unk);
}

/* ───────── 5. amortising the posterior mean ───────── */
{
  const al = alphasOf(1, 'walk'), phis = anglesOf(al), A = designOf(phis), m = phis.length, P = posteriorQR(phis, SIG, PRIORS.learned), un = unseenIdx(al), H = PROBES.map(row);
  function trainMap(N, seed) {                                    // ridge regression of theta on (r, 1), normal equations + Cholesky
    const rng = FL.rng(seed), p = m + 1, XtX = Array.from({ length: p }, () => new Array(p).fill(0)), XtY = Array.from({ length: p }, () => new Array(D).fill(0));
    for (let t = 0; t < N; t++) {
      const th = worldObject(rng, false), r = readingsOf(A, th, SIG, rng), x = r.concat([1]);
      for (let i = 0; i < p; i++) { for (let j = 0; j < p; j++) XtX[i][j] += x[i] * x[j]; for (let k = 0; k < D; k++) XtY[i][k] += x[i] * th[k]; }
    }
    for (let i = 0; i < p; i++) XtX[i][i] += 1e-6 * N;
    const L = cholesky(XtX), B = Array.from({ length: p }, () => new Array(D).fill(0));
    for (let k = 0; k < D; k++) { const y = new Array(p); for (let i = 0; i < p; i++) { let s = XtY[i][k]; for (let j = 0; j < i; j++) s -= L[i][j] * y[j]; y[i] = s / L[i][i]; } const x = new Array(p); for (let i = p - 1; i >= 0; i--) { let s = y[i]; for (let j = i + 1; j < p; j++) s -= L[j][i] * x[j]; x[i] = s / L[i][i]; } for (let i = 0; i < p; i++) B[i][k] = x[i]; }
    return r => { const out = new Array(D).fill(0); for (let k = 0; k < D; k++) { let s = B[m][k]; for (let i = 0; i < m; i++) s += r[i] * B[i][k]; out[k] = s; } return out; };
  }
  const errOf = (mean, th, unIdx) => { let se = 0; for (const j of unIdx) { const e = dot(H[j], mean) - dot(H[j], th); se += e * e; } return Math.sqrt(se / unIdx.length); };
  for (const N of [10, 30, 100, 2000]) { const f = trainMap(N, 777), c = calibrate(al, SIG, PRIORS.learned, false, NCAL, SEED_CAL, f); facts['am_e' + N] = c.rmse * CM; }
  facts.am_closed = facts.e_learn1;
  ok('learned map with 2000 pairs matches the closed form within 2 %', Math.abs(facts.am_e2000 / facts.am_closed - 1) < 0.02, [facts.am_e2000, facts.am_closed]);
  ok('learned map with 10 pairs is useless', facts.am_e10 > 2.5 * facts.am_closed);
  ok('learned map with 100 pairs is within 10 % of the closed form', Math.abs(facts.am_e100 / facts.am_closed - 1) < 0.1, [facts.am_e100, facts.am_closed]);
  const map = trainMap(2000, 777);
  // layout tests on the same 1000 objects: shuffle the list, lose two returns, move the camera by 25 degrees
  const rng = FL.rng(SEED_CAL), pr = FL.rng(55), moved = alphasOf(1, 'walk').map(a => a + 25 * PI / 180), phisM = anglesOf(moved), AM = designOf(phisM), PM = posteriorQR(phisM, SIG, PRIORS.learned), unM = unseenIdx(moved);
  const rng2 = FL.rng(SEED_CAL + 1);
  const acc = { closed: 0, map: 0, closedShuf: 0, mapShuf: 0, closedDrop: 0, mapDrop: 0, closedMoved: 0, mapMoved: 0, mean: 0 };
  let worstShuf = 0;
  for (let t = 0; t < NCAL; t++) {
    const th = worldObject(rng, false), r = readingsOf(A, th, SIG, rng);
    acc.closed += errOf(P.solve(r), th, un) / NCAL; acc.map += errOf(map(r), th, un) / NCAL; acc.mean += errOf(PRIORS.learned.mu, th, un) / NCAL;
    const idx = Array.from({ length: m }, (_, i) => i); for (let i = m - 1; i > 0; i--) { const j = Math.floor(pr() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
    // the closed form takes (direction, reading) pairs: shuffle the pairs; the map takes a list: shuffle the list
    const Ash = idx.map(i => A[i]), rsh = idx.map(i => r[i]);
    const sh = (() => { const Mst = Ash.map(rw => rw.map(x => x / SIG)).concat(lowerInverse(cholesky(PRIORS.learned.Lam))); const { Q, R } = qr(Mst); const b = rsh.map(x => x / SIG).concat(matvec(lowerInverse(cholesky(PRIORS.learned.Lam)), PRIORS.learned.mu)); const Qtb = new Array(D).fill(0); for (let j = 0; j < D; j++) for (let i = 0; i < b.length; i++) Qtb[j] += Q[i][j] * b[i]; return backSolve(R, Qtb); })();
    const a0 = P.solve(r); worstShuf = Math.max(worstShuf, ...a0.map((x, i) => Math.abs(x - sh[i])));
    acc.closedShuf += errOf(sh, th, un) / NCAL; acc.mapShuf += errOf(map(rsh), th, un) / NCAL;
    const keep = [0, 1, 2, 4, 5, 6, 8], Ad = keep.map(i => A[i]), rd = keep.map(i => r[i]);
    const dropMean = (() => { const Li = lowerInverse(cholesky(PRIORS.learned.Lam)); const Mst = Ad.map(rw => rw.map(x => x / SIG)).concat(Li); const { Q, R } = qr(Mst); const b = rd.map(x => x / SIG).concat(matvec(Li, PRIORS.learned.mu)); const Qtb = new Array(D).fill(0); for (let j = 0; j < D; j++) for (let i = 0; i < b.length; i++) Qtb[j] += Q[i][j] * b[i]; return backSolve(R, Qtb); })();
    acc.closedDrop += errOf(dropMean, th, un) / NCAL;
    const rz = r.slice(); rz[3] = 0; rz[7] = 0; acc.mapDrop += errOf(map(rz), th, un) / NCAL;
    const th2 = worldObject(rng2, false), rM = readingsOf(AM, th2, SIG, rng2);
    acc.closedMoved += errOf(PM.solve(rM), th2, unM) / NCAL; acc.mapMoved += errOf(map(rM), th2, unM) / NCAL;
  }
  ok('the closed form does not care about the order of the list (1e-9)', worstShuf < 1e-9, worstShuf);
  facts.lay_closed = acc.closed * CM; facts.lay_map = acc.map * CM;
  facts.lay_closed_shuf = acc.closedShuf * CM; facts.lay_map_shuf = acc.mapShuf * CM;
  facts.lay_closed_drop = acc.closedDrop * CM; facts.lay_map_drop = acc.mapDrop * CM;
  facts.lay_closed_moved = acc.closedMoved * CM; facts.lay_map_moved = acc.mapMoved * CM;
  facts.lay_guess = acc.mean * CM;
  ok('closed form: shuffled list gives the same error', close(facts.lay_closed, facts.lay_closed_shuf, 1e-9));
  ok('learned map: a shuffled list is worse than guessing the mean shape', facts.lay_map_shuf > facts.lay_guess, [facts.lay_map_shuf, facts.lay_guess]);
  ok('learned map: two missing returns hurt it much more than the closed form', facts.lay_map_drop > 1.4 * facts.lay_closed_drop, [facts.lay_map_drop, facts.lay_closed_drop]);
  ok('learned map: a moved camera ruins it, the closed form is unaffected', facts.lay_map_moved > 3 * facts.lay_closed_moved && close(facts.lay_closed_moved, facts.lay_closed, 0.5), [facts.lay_map_moved, facts.lay_closed_moved]);
  facts.lay_shuf_ratio = facts.lay_map_shuf / facts.lay_map;
}

/* ───────── 6. real scale ───────── */
{
  const d = Math.pow(128, 3);
  facts.d_vox = d; facts.d2_e12 = d * d / 1e12; facts.bytes_tb = 4 * d * d / 1e12; facts.d3_e18 = d * d * d / 1e18;
  facts.d2_toy = D * D; facts.d_pow2 = Math.log2(d);
}

/* ───────── 7. scale and focal length (lesson 1's table), the log-normal size prior ───────── */
{
  const f = 44, s = f * 1 / 2.5;                                   // the crate: 1 m wide at 2.5 m
  facts.px_w = s;
  for (const [w, Z] of [[1, 2.5], [2, 5], [4, 10]]) ok('same width in pixels', close(f * w / Z, s, 1e-12));
  const sg = 0.5, Zmed = f * 1 / s;                                // prior: ln w ~ N(ln 1 m, 0.5^2)
  facts.z_med = Zmed; facts.z_lo = Zmed * Math.exp(-sg); facts.z_hi = Zmed * Math.exp(sg);
  facts.wall_dens = Math.exp(-0.5 * Math.pow(Math.log(4 / 1) / sg, 2)); facts.wall_sigmas = Math.log(4) / sg;
  facts.gpu_hours = 64 * 9 * 24; facts.vggt_speedup = 10 / 0.2;
}

/* ───────── 8. the checkpoint (one dimension) ───────── */
{
  const tau = 0.10, sg = 0.05, r = 0.15, prec = 1 / (tau * tau) + 1 / (sg * sg);
  facts.ck_m = (r / (sg * sg)) / prec; facts.ck_s = Math.sqrt(1 / prec);
  const tau2 = 0.01, prec2 = 1 / (tau2 * tau2) + 1 / (sg * sg);
  facts.ck_m2 = (r / (sg * sg)) / prec2; facts.ck_s2 = Math.sqrt(1 / prec2);
  facts.ck_unseen_cm = tau * CM;
}

/* ───────── 9. drive the page's widget into every state "What to try" describes ───────── */
facts.un_around2 = 100 * unseenIdx(alphasOf(2, 'around')).length / 72;
const page = loadPage(path.join(DIR, '11_when_views_run_out_priors.html'), { dpr: 1 });
ok('page loads cleanly', page.problems.length === 0, page.problems.join(' | '));
/* the single object the widget draws, recomputed with the independent posterior: statue, or the world's object `draw`, readings from FL.rng(500 + draw) */
function single(V, p, prior, obj, sigma, draw) {
  const al = alphasOf(V, p), phis = anglesOf(al), P = posteriorQR(phis, sigma, PRIORS[prior]), un = unseenIdx(al), H = PROBES.map(row);
  const th = obj === 'statue' ? Array.from(SH.statueTheta()) : worldObject(FL.rng(700 + draw), obj === 'ood');
  const r = readingsOf(P.A, th, sigma, FL.rng(500 + draw)), mean = P.solve(r);
  let se = 0, bar = 0, cU = 0, cS = 0, nS = 0;
  PROBES.forEach((_, j) => {
    const e = dot(H[j], mean) - dot(H[j], th), inb = Math.abs(e) <= 2 * P.std[j];
    if (isSeen(PROBES[j], al)) { nS++; if (inb) cS++; } else { se += e * e; bar += P.std[j]; if (inb) cU++; }
  });
  const nU = un.length, svs = svd(P.A).s;
  return { err: nU ? Math.sqrt(se / nU) * CM : NaN, bar: nU ? bar / nU * CM : NaN, cU: nU ? 100 * cU / nU : NaN, cS: nS ? 100 * cS / nS : NaN, un: 100 * nU / 72, nd: svs.filter(s => s < sigma).length };
}
function setAll(c) {
  page.set('w11-path', c.path); page.set('w11-prior', c.prior); page.set('w11-obj', c.obj); page.set('w11-sig', c.sig); page.set('w11-views', c.views);
}
function compareState(label, c, draw) {
  setAll(c);
  for (let d = 0; d < draw; d++) page.click('w11-draw');
  const mine = single(c.views, c.path, c.prior, c.obj, c.sig, draw), cl = calibrate(alphasOf(c.views, c.path), c.sig, PRIORS[c.prior], c.obj === 'ood', NCAL, SEED_CAL);
  ok(label + ': unseen share', close(page.num('w11-m-un'), mine.un, 0.51), [page.num('w11-m-un'), mine.un]);
  ok(label + ': directions below the noise', page.num('w11-m-nd') === mine.nd, [page.num('w11-m-nd'), mine.nd]);
  ok(label + ': unseen error', close(page.num('w11-m-err'), mine.err, 0.051), [page.num('w11-m-err'), mine.err]);
  ok(label + ': error bar', close(page.num('w11-m-bar'), mine.bar, 0.051), [page.num('w11-m-bar'), mine.bar]);
  ok(label + ': coverage seen', close(page.num('w11-m-cs'), mine.cS, 0.51), [page.num('w11-m-cs'), mine.cS]);
  ok(label + ': coverage unseen', close(page.num('w11-m-cu'), mine.cU, 0.51), [page.num('w11-m-cu'), mine.cU]);
  ok(label + ': typical error over 1000 objects', close(page.num('w11-m-typ'), cl.rmse * CM, 0.051), [page.num('w11-m-typ'), cl.rmse * CM]);
  ok(label + ': coverage over 1000 objects', close(page.num('w11-m-cal'), 100 * cl.cov, 0.51), [page.num('w11-m-cal'), 100 * cl.cov]);
  return { mine, cl };
}
const base = { views: 1, path: 'walk', prior: 'none', obj: 'statue', sig: 0.01 };
{
  const s0 = compareState('opening state', base, 0);
  facts.w_err_none = s0.mine.err;
  ok('opening: the bar is the 146 cm of the table', close(page.num('w11-m-bar'), facts.bar_none1, 0.051));
  ok('opening: 72 % unseen, 3 directions below the noise', page.num('w11-m-un') === 72 && page.num('w11-m-nd') === 3);
  ok('opening: every camera count label is right', page.text('w11-views-v') === '1 camera' && page.text('w11-sig-v') === '1.2 cm', [page.text('w11-views-v'), page.text('w11-sig-v')]);
  const s1 = compareState('smooth', { ...base, prior: 'smooth' }, 0); facts.w_err_smooth = s1.mine.err;
  const s2 = compareState('learned', { ...base, prior: 'learned' }, 0); facts.w_err_learn = s2.mine.err;
  // ten draws of the statue with the learned prior: click "another draw" and compare each time with the independent path
  setAll({ ...base, prior: 'learned' });
  const errs = [single(1, 'walk', 'learned', 'statue', 0.01, 0).err];
  for (let d = 1; d < 10; d++) {
    page.click('w11-draw'); const mine = single(1, 'walk', 'learned', 'statue', 0.01, d);
    ok('draw ' + d + ': unseen error', close(page.num('w11-m-err'), mine.err, 0.051), [page.num('w11-m-err'), mine.err]);
    errs.push(mine.err);
  }
  facts.w_err_learn_lo = Math.min(...errs); facts.w_err_learn_hi = Math.max(...errs);
  ok('the statue is a friendlier object than the average one', facts.w_err_learn_hi < facts.e_learn1, [facts.w_err_learn_hi, facts.e_learn1]);
  ok('the first draw is the same one the page opens on', close(errs[0], facts.w_err_learn, 1e-12));
}
{
  const s3 = compareState('learned, four cameras', { ...base, prior: 'learned', views: 4 }, 0);
  ok('learned, four cameras: typical error is the table value', close(page.num('w11-m-typ'), facts.e_learn4, 0.051));
  compareState('no prior, four cameras', { ...base, views: 4 }, 0);
  ok('no prior, four cameras: 27.5 cm', close(page.num('w11-m-typ'), facts.e_none4, 0.051));
  compareState('all around, two cameras', { ...base, path: 'around', views: 2 }, 0);
  ok('all around, two cameras: 4.3 cm and 44 % unread', close(page.num('w11-m-typ'), facts.e_around2, 0.051) && page.num('w11-m-un') === 44, [page.num('w11-m-typ'), page.num('w11-m-un')]);
  compareState('all around, three cameras', { ...base, path: 'around', views: 3 }, 0);
  ok('all around, three cameras: 17 % unread', page.num('w11-m-un') === 17);
  // four cameras all round: nothing is unseen, the page must say so instead of printing a number
  setAll({ ...base, path: 'around', views: 4 });
  ok('all around, four cameras: no unseen side, no unseen statistics', page.text('w11-m-err') === '—' && page.text('w11-m-typ') === '—' && page.text('w11-m-un') === '0 %', [page.text('w11-m-err'), page.text('w11-m-typ'), page.text('w11-m-un')]);
}
{
  const o = compareState('out of family', { ...base, prior: 'learned', obj: 'ood' }, 0);
  ok('out of family: bar 3.8, typical error 14.4, 44 % inside', close(page.num('w11-m-bar'), facts.bar_learn1, 0.051) && close(page.num('w11-m-typ'), facts.ood_e_learn, 0.051) && page.num('w11-m-cal') === Math.round(facts.ood_cov_learn), [page.num('w11-m-bar'), page.num('w11-m-typ'), page.num('w11-m-cal')]);
  compareState('random object from the world', { ...base, prior: 'learned', obj: 'world' }, 0);
  ok('random object: the 1000-object statistics are the in-family ones', close(page.num('w11-m-typ'), facts.e_learn1, 0.051) && page.num('w11-m-cal') === Math.round(facts.cov_learn1));
  compareState('random out-of-family object, smooth prior', { ...base, prior: 'smooth', obj: 'ood' }, 3);
  const n = compareState('noise 4.6 cm', { ...base, prior: 'learned', sig: 0.04 }, 0);
  facts.w_sig04_cm = 0.04 * CM; facts.w_typ_sig04 = n.cl.rmse * CM;
  ok('noise slider label', page.text('w11-sig-v') === '4.6 cm', page.text('w11-sig-v'));
  ok('the learned prior hardly cares about the noise (3.9 -> 4.9)', facts.w_typ_sig04 < 1.4 * facts.e_learn1, [facts.w_typ_sig04, facts.e_learn1]);
  ok('noise 4.6 cm: the lesson says 4.9', close(page.num('w11-m-typ'), facts.w_typ_sig04, 0.051));
}
ok('widget ran without errors', page.problems.length === 0, page.problems.join(' | '));

console.error(fails ? `${fails} check(s) FAILED` : 'all checks passed');
console.log(JSON.stringify({ facts }));
process.exit(fails ? 1 : 0);
