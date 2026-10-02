#!/usr/bin/env node
/* Oracle for World Models lesson 05, "One future is a lie: distributions".
 *
 * The experiment: the Courtyard's FORK (a diamond post just after the curtain).  The launcher's lateral aim error b ~ N(0, 0.15^2) is hidden;
 * the model sees ONE noisy reading z = 2.5 + b + eps (eps ~ N(0, 0.1^2)) and must predict where the ball is 4 s after launch (height y, and x for
 * the 2-D picture).  The world is deterministic: the outcome is a function f(b, vx).
 *
 * Independent checks (closed forms and quadrature, not the networks):
 *   - the posterior of b given z (precisions add) and the conditional MEAN and the conditional P(up) by quadrature over b with the engine's f;
 *   - least squares gives the conditional mean: the trained squared-error net is compared with E[y|z] by quadrature;
 *   - the mixture head's weights are compared with the quadrature P(up | z), the ensemble's behaviour inside vs outside the data;
 *   - the two-point example of the lesson (c* = (2 pi - 1) d, loss 4 pi (1 - pi) d^2), the ambiguity fractions for 1 and 10 readings (Monte Carlo vs closed form),
 *   - the self-feeding arithmetic 1 - (1 - q)^k.
 * Then the page's own widget is driven into the states the prose describes and its readouts are compared.
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
function ok(name, cond, extra) { if (!cond) { fails++; console.error('FAIL', name, extra === undefined ? '' : extra); } }
const close = (a, b, tol) => Math.abs(a - b) <= (tol === undefined ? 1e-9 : tol);
const PHI = CY.stats.ncdf;

/* ── protocol (shared with the widget) ── */
const W = CY.scenes.fork(), TFIN = 40, SB = 0.15, SO = 0.1, NTR = 800, NTE = 2000, EP = 60, H = 10;
const outcome = (b, vx) => { let s = [0.5, 2.5 + b, vx, 0]; for (let t = 0; t < TFIN; t++) s = CY.step(W, s, null); return s; };
function gen(n, seed) {
  const r = CY.rng(seed), X = [], Y = [], XO = [], B = [];
  for (let i = 0; i < n; i++) { const b = SB * CY.randn(r), vx = 2.3 + 0.2 * r(), z = 2.5 + b + SO * CY.randn(r), o = outcome(b, vx); X.push([(z - 2.5) / 0.15]); Y.push((o[1] - 2.5) / 1.2); XO.push((o[0] - 4.4) / 0.5); B.push(b); }
  return { X, Y, XO, B };
}
const tr = gen(NTR, 1), te = gen(NTE, 2);

/* ── 1. the fork's map b -> outcome, scanned ── */
const GRID = []; for (let i = 0; i <= 1600; i++) GRID.push(-0.8 + i * 0.001);
const FY = GRID.map(b => outcome(b, 2.4)[1]);
{
  const bc = GRID.find((b, i) => b > 0 && Math.abs(FY[i] - 2.5) > 1.0);
  facts.b_clean = bc; facts.b_clean_cm = 100 * bc;                                    // smallest aim offset (m) whose ball is cleanly up/down (more than 1 m from the centre line after 4 s)
  const at = b => FY[Math.round((b + 0.8) / 0.001)], up = at(0.3), dn = at(-0.3);
  ok('cleanly up / down for large offsets', up > 3.3 && dn < 1.7, [up, dn]);
  // sign structure: for b > b_clean outcomes are above the centre line, for b < -b_clean below
  ok('sign of the offset decides the branch', FY.every((y, i) => (GRID[i] > 0.08 ? y > 3.0 : true) && (GRID[i] < -0.08 ? y < 2.0 : true)));
  // the lesson says: beyond the stall band the ending is more than a metre from the centre line (checked for every offset the prior can plausibly produce, |b| < 0.6)
  ok('every offset with 4.3 cm < |b| < 0.6 m ends more than a metre from the centre line (launch speed 2.4)', GRID.every((b, i) => Math.abs(b) < bc - 1e-9 || Math.abs(b) > 0.6 || Math.abs(FY[i] - 2.5) > 1.0));
  // the band depends on the launch speed (2.3 to 2.5 m/s): the same threshold at the slowest and the fastest launch
  const edge = vx => { for (let i = 1; i <= 800; i++) { const b = i * 0.001; if (Math.abs(outcome(b, vx)[1] - 2.5) > 1.0) return b; } return NaN; };
  facts.b_clean_slow_cm = 100 * edge(2.3); facts.b_clean_fast_cm = 100 * edge(2.5); facts.band_width_cm = 2 * facts.b_clean_cm;
  ok('the stall band narrows as the launch gets faster (slow > middle > fast)', facts.b_clean_slow_cm > facts.b_clean_cm && facts.b_clean_cm > facts.b_clean_fast_cm, [facts.b_clean_slow_cm, facts.b_clean_cm, facts.b_clean_fast_cm]);
  // mirror symmetry: the ball ends above the centre line exactly when b > 0 (every speed, 1600 offsets)
  let bad = 0; for (const vx of [2.3, 2.35, 2.4, 2.45, 2.5]) for (let i = -800; i <= 800; i++) { if (i === 0) continue; const b = i * 0.001; if ((outcome(b, vx)[1] > 2.5) !== (b > 0)) bad++; }
  ok('the ball ends above the centre line exactly when b > 0 (5 launch speeds x 1600 offsets)', bad === 0, bad);
}

/* ── 2. the posterior of b given one reading, in closed form ── */
const pPrec = 1 / (SB * SB) + 1 / (SO * SO), PSTD = Math.sqrt(1 / pPrec), PGAIN = (1 / (SO * SO)) / pPrec;      // N(PGAIN * z', PSTD^2) with z' = z - 2.5
facts.post_std = PSTD; facts.post_gain = PGAIN; facts.post_std_cm = 100 * PSTD;
{ // Monte-Carlo check of the posterior: condition on z' in a thin slice
  const r = CY.rng(40); let n = 0, s = 0, s2 = 0;
  for (let i = 0; i < 2000000; i++) { const b = SB * CY.randn(r), z = b + SO * CY.randn(r); if (Math.abs(z - 0.1) < 0.01) { n++; s += b; s2 += b * b; } }
  const m = s / n, v = s2 / n - m * m;
  ok('posterior mean (z\' = 0.1)', close(m, PGAIN * 0.1, 0.004), [m, PGAIN * 0.1]);
  ok('posterior std', close(Math.sqrt(v), PSTD, 0.004), [Math.sqrt(v), PSTD]);
}
// quadrature over b with the engine's f: conditional mean and P(up) at a reading z' = z - 2.5
const FYX = GRID.map(b => outcome(b, 2.4));
function condQuad(zp) {
  const mu = PGAIN * zp; let Z = 0, Ey = 0, Ex = 0, Pup = 0, Pdn = 0, Pmid = 0, Pabv = 0;
  GRID.forEach((b, i) => { const wgt = Math.exp(-0.5 * ((b - mu) / PSTD) ** 2); Z += wgt; Ey += wgt * FYX[i][1]; Ex += wgt * FYX[i][0]; const dy = FYX[i][1] - 2.5; if (dy > 1e-9) Pabv += wgt; else if (Math.abs(dy) <= 1e-9) Pabv += wgt / 2; if (FYX[i][1] > 3.05) Pup += wgt; else if (FYX[i][1] < 1.95) Pdn += wgt; else Pmid += wgt; });
  return { ey: Ey / Z, ex: Ex / Z, up: Pup / Z, dn: Pdn / Z, mid: Pmid / Z, abv: Pabv / Z };
}
{ const q0 = condQuad(0); facts.share_up0 = 100 * q0.up; facts.share_dn0 = 100 * q0.dn; facts.share_mid0 = 100 * q0.mid; facts.ey0_quad = q0.ey; facts.ex0_quad = q0.ex; }
// how many launches stay ambiguous with m readings averaged
function ambiguous(m) {
  const pp = 1 / (SB * SB) + m / (SO * SO), s = Math.sqrt(1 / pp), g = (m / (SO * SO)) / pp * 1;   // posterior mean = g * zbar'
  const sd_z = Math.sqrt(SB * SB + SO * SO / m);
  const lim = 1.2816 * s / g;                                // |g zbar'| / s < 1.2816  <=>  P(b > 0 | zbar) in (0.1, 0.9)
  return 100 * (2 * PHI(lim / sd_z) - 1);
}
facts.amb1 = ambiguous(1); facts.amb10 = ambiguous(10);
facts.post_std10 = Math.sqrt(1 / (1 / (SB * SB) + 10 / (SO * SO))); facts.post_std10_cm = 100 * facts.post_std10;
{ // Monte Carlo of the same
  const r = CY.rng(41); for (const m of [1, 10]) {
    const pp = 1 / (SB * SB) + m / (SO * SO), s = Math.sqrt(1 / pp); let amb = 0; const n = 200000;
    for (let i = 0; i < n; i++) { const b = SB * CY.randn(r); let zs = 0; for (let j = 0; j < m; j++) zs += b + SO * CY.randn(r); const mu = (zs / SO ** 2) / pp, p = PHI(mu / s); if (p > 0.1 && p < 0.9) amb++; }
    ok('ambiguity fraction, m = ' + m, close(100 * amb / n, m === 1 ? facts.amb1 : facts.amb10, 0.6), [100 * amb / n, m === 1 ? facts.amb1 : facts.amb10]);
  }
}

/* ── 3. squared error gives the mean: the two-point example ── */
{ const d = 1.2, pi = 0.5; facts.mid_loss_ratio = 4 * pi * (1 - pi) * d * d / (2 * pi * 2 * d * d / 1);   // loss of the mean over loss of always predicting one branch (pi = 1/2)
  // direct: predict c, loss = pi (d - c)^2 + (1 - pi)(d + c)^2 ; minimise over a grid
  let best = Infinity, cb = 0; for (let c = -2; c <= 2; c += 0.0005) { const L = pi * (d - c) ** 2 + (1 - pi) * (d + c) ** 2; if (L < best) { best = L; cb = c; } }
  ok('two-point optimum c* = (2 pi - 1) d', close(cb, (2 * pi - 1) * d, 0.001), cb); ok('loss at the optimum 4 pi (1-pi) d^2', close(best, 4 * pi * (1 - pi) * d * d / 1, 1e-3) || close(best, d * d, 1e-3), best);
  facts.two_point_loss_mean = best; facts.two_point_loss_branch = pi * 0 + (1 - pi) * (2 * d) ** 2;
}

/* ── 4. the models (replay of the widget's training) ── */
const Y2 = tr.Y.map((y, i) => [tr.XO[i], y]);
const mse = new CY.MLP([1, H, H, 2], 3); mse.fit(tr.X, Y2, { epochs: EP, lr: 0.01, batch: 32, seed: 3 });
const mseAt = zp => { const o = mse.predict([zp / 0.15]); return { x: o[0] * 0.5 + 4.4, y: o[1] * 1.2 + 2.5 }; };
const MDN = {}; for (const K of [1, 2, 3, 4]) { const net = new CY.MLP([1, H, H, 3 * K], 5 + K); net.fitMDN(tr.X, tr.Y, K, { epochs: EP, lr: 0.01, batch: 32, seed: 3 }); MDN[K] = net; }
const nllOf = K => { let s = 0; te.X.forEach((x, i) => { s += -Math.log(Math.max(1e-12, CY.mdn.density(MDN[K].predict(x), K, te.Y[i]))) / te.X.length; }); return s; };
for (const K of [1, 2, 3, 4]) facts['nll' + K] = nllOf(K);
ok('NLL falls from K = 1 to K = 2 to K = 3', facts.nll1 > facts.nll2 + 0.3 && facts.nll2 > facts.nll3 + 0.08, [facts.nll1, facts.nll2, facts.nll3]);
ok('and gains almost nothing at K = 4', facts.nll3 - facts.nll4 < 0.05, [facts.nll3, facts.nll4]);
{ // the squared-error net against the conditional mean by quadrature
  let worst = 0; for (const zp of [-0.3, -0.15, 0, 0.15, 0.3]) worst = Math.max(worst, Math.abs(mseAt(zp).y - condQuad(zp).ey));
  ok('squared-error net == conditional mean by quadrature (|diff| < 0.2 m over z in [-0.3, 0.3])', worst < 0.2, worst);
  facts.mse_y0 = mseAt(0).y; facts.mse_x0 = mseAt(0).x; facts.mse_quad_gap = Math.abs(mseAt(0).y - condQuad(0).ey);
  const m0 = mseAt(0); facts.mse_depth = 0.6 - (Math.abs(m0.x - 4.4) + Math.abs(m0.y - 2.5));      // how far inside the diamond (|x - 4.4| + |y - 2.5| <= 0.6) the mean prediction is
  ok('the mean prediction at z = 0 is INSIDE the post', facts.mse_depth > 0, facts.mse_depth);
}
function mixAt(K, zp) { const m = CY.mdn.mixture(MDN[K].predict([zp / 0.15]), K); return { pi: Array.from(m.pi), mu: Array.from(m.mu).map(v => v * 1.2 + 2.5), sg: Array.from(m.sg).map(v => v * 1.2) }; }
const pUpMix = (K, zp) => { const m = mixAt(K, zp); let p = 0; for (let k = 0; k < K; k++) p += m.pi[k] * (1 - PHI((2.5 - m.mu[k]) / m.sg[k])); return p; };
{ // mixture weights vs the quadrature truth
  let worst = 0; for (const zp of [-0.3, -0.2, -0.1, 0, 0.1, 0.2, 0.3]) worst = Math.max(worst, Math.abs(pUpMix(3, zp) - (condQuad(zp).up + 0.5 * condQuad(zp).mid)));
  ok('K = 3 mixture P(up | z) tracks the quadrature truth to within 0.2', worst < 0.2, worst);
  facts.pup0_k1 = 100 * pUpMix(1, 0); facts.pup0_k3 = 100 * pUpMix(3, 0); facts.pup02_k3 = 100 * pUpMix(3, 0.2);
  // the ball ends above the centre line exactly when b > 0, so the exact P(up | reading z') is the posterior P(b > 0) = PHI(PGAIN z' / PSTD); the quadrature of the indicator y > 2.5 through the simulator must agree
  facts.pup02_true = 100 * PHI(PGAIN * 0.2 / PSTD); facts.post_ratio = PGAIN / PSTD;
  ok('exact P(up | z\' = 0.2) = PHI(PGAIN z\' / PSTD) agrees with the quadrature of the indicator y > 2.5 through the simulator (0.2 points)', Math.abs(100 * condQuad(0.2).abv - facts.pup02_true) < 0.2, [100 * condQuad(0.2).abv, facts.pup02_true]);
  ok('exact P(up | z\' = 0) = 1/2', Math.abs(condQuad(0).abv - 0.5) < 1e-9, condQuad(0).abv);
}
/* conditional truth by sampling b | z with the simulator (what the widget draws) */
const rE = CY.rng(3), E = [], VX = []; for (let i = 0; i < 300; i++) { E.push(CY.randn(rE)); VX.push(2.3 + 0.2 * rE()); }
const condSamples = zp => E.map((e, i) => outcome(PGAIN * zp + PSTD * e, VX[i]));
const BAND = 0.55;
function valleyMass(K, zp) { const m = mixAt(K, zp); let s = 0; for (let k = 0; k < K; k++) s += m.pi[k] * (PHI((2.5 + BAND - m.mu[k]) / m.sg[k]) - PHI((2.5 - BAND - m.mu[k]) / m.sg[k])); return s; }
for (const K of [1, 2, 3, 4]) facts['valley' + K] = 100 * valleyMass(K, 0);
{ // the long-run shares at the centre reading: posterior of b (Gaussian) x launch speed (uniform on 2.3 to 2.5), through the simulator; the 300 widget dots are a sample of this
  const NV = 11; let Z = 0, up = 0, dn = 0, mid = 0, stall = 0;
  for (let j = 0; j < NV; j++) { const vx = 2.3 + 0.2 * j / (NV - 1); for (let i = -600; i <= 600; i++) { const b = i * 0.001, w = Math.exp(-0.5 * (b / PSTD) ** 2), y = outcome(b, vx)[1]; Z += w; if (y >= 2.5 + BAND) up += w; else if (y <= 2.5 - BAND) dn += w; else mid += w; if (Math.abs(y - 2.5) <= 1.0) stall += w; } }
  facts.up_exact = 100 * up / Z; facts.dn_exact = 100 * dn / Z; facts.valley_exact = 100 * mid / Z; facts.stall_share0 = stall / Z;
  ok('long-run shares at the centre reading: up = down by symmetry', Math.abs(facts.up_exact - facts.dn_exact) < 0.05, [facts.up_exact, facts.dn_exact]);
  ok('the 300 widget dots are a sample of the long-run shares (within 3 standard errors)', Math.abs(valleyTrue300() - facts.valley_exact) < 3 * 100 * Math.sqrt(facts.valley_exact / 100 * (1 - facts.valley_exact / 100) / 300), [valleyTrue300(), facts.valley_exact]);
}
function valleyTrue300() { const cs = condSamples(0); return 100 * cs.filter(s => Math.abs(s[1] - 2.5) < BAND).length / cs.length; }
{ // K = 3 at the centre reading: one component sits in the middle (level with the post) and its weight is the share of launches inside the stall band
  const m3 = mixAt(3, 0), mids = [0, 1, 2].filter(k => Math.abs(m3.mu[k] - 2.5) < BAND);
  ok('K = 3, centre reading: exactly one component has its mean level with the post', mids.length === 1, m3.mu);
  facts.mid_w3 = m3.pi[mids[0]];
  ok('... and its weight is the stall-band share to within 0.08 (the other two are the up and down clusters)', Math.abs(facts.mid_w3 - facts.stall_share0) < 0.08, [facts.mid_w3, facts.stall_share0]);
  ok('... the other two components are the clusters (means above 3.3 m and below 1.7 m)', [0, 1, 2].filter(k => !mids.includes(k)).every(k => m3.mu[k] > 3.3 || m3.mu[k] < 1.7), m3.mu);
}
{ // calibration needs a noise floor: a perfectly calibrated forecaster (the exact posterior probability) scored the same way on 2000 launches with simulated outcomes
  const NB = 8, eceOf = (ps, obs) => { const cnt = new Array(NB).fill(0), sp = new Array(NB).fill(0), so = new Array(NB).fill(0); let e = 0; ps.forEach((p, i) => { const b = Math.min(NB - 1, Math.floor(p * NB)); cnt[b]++; sp[b] += p; so[b] += obs[i] ? 1 : 0; }); for (let b = 0; b < NB; b++) if (cnt[b]) e += cnt[b] / ps.length * Math.abs(so[b] / cnt[b] - sp[b] / cnt[b]); return e; };
  const pex = te.X.map(x => PHI(PGAIN * x[0] * 0.15 / PSTD)), r = CY.rng(123); let tot = 0; const R = 300;
  for (let k = 0; k < R; k++) tot += eceOf(pex, pex.map(p => r() < p));
  facts.ece_floor = 100 * tot / R; facts.ece_exact = 100 * eceOf(pex, te.Y.map(y => y > 0));
  ok('the exact forecaster is calibrated on the held-out launches to within sampling noise (its gap is below 2.5 points)', facts.ece_exact < 2.5, facts.ece_exact);
}
{ const cs = condSamples(0); facts.valley_true = 100 * cs.filter(s => Math.abs(s[1] - 2.5) < BAND).length / cs.length; facts.up_s0 = 100 * cs.filter(s => s[1] >= 2.5 + BAND).length / cs.length; facts.dn_s0 = 100 * cs.filter(s => s[1] <= 2.5 - BAND).length / cs.length;
  const m0 = mseAt(0); facts.mse_nearest = Math.min.apply(null, cs.map(s => Math.hypot(s[0] - m0.x, s[1] - m0.y))); }
{ // density at the squared-error prediction vs at the main mode, from the K = 3 mixture
  const m0 = mixAt(3, 0), dens = y => { let d = 0; for (let k = 0; k < 3; k++) d += m0.pi[k] * CY.stats.npdf(y, m0.mu[k], m0.sg[k]); return d; };
  let peak = 0; for (let y = 0; y <= 5; y += 0.01) peak = Math.max(peak, dens(y)); facts.dens_ratio_mean = dens(mseAt(0).y) / peak; facts.dens_pct = 100 * facts.dens_ratio_mean;
}
/* unsupported samples: farther than 0.1 m from every training outcome */
const trY = tr.Y.map(v => v * 1.2 + 2.5).slice().sort((a, b) => a - b);
function nnDist(y) { let lo = 0, hi = trY.length - 1; while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (trY[mid] < y) lo = mid; else hi = mid; } return Math.min(Math.abs(trY[lo] - y), Math.abs(trY[hi] - y)); }
const UNS = 0.1;
function unsupported(K, zp, n) { const r = CY.rng(9); let c = 0; const net = MDN[K], o = net.predict([zp / 0.15]); for (let i = 0; i < n; i++) { const y = CY.mdn.sample(o, K, r) * 1.2 + 2.5; if (nnDist(y) > UNS) c++; } return c / n; }
for (const K of [1, 2, 3, 4]) { let a = 0, c = 0; for (const zp of [-0.3, -0.2, -0.1, 0, 0.1, 0.2, 0.3]) { a += unsupported(K, zp, 4000); c++; } facts['unsup' + K] = 100 * a / c; }
facts.train_min = trY[0]; facts.train_max = trY[trY.length - 1];
{ // the single Gaussian's off-data samples are its tails: heights below the lowest or above the highest training ending (to within the 0.1 m tolerance)
  let off = 0, tail = 0; for (const zp of [-0.3, -0.2, -0.1, 0, 0.1, 0.2, 0.3]) { const r = CY.rng(9), o = MDN[1].predict([zp / 0.15]); for (let i = 0; i < 4000; i++) { const y = CY.mdn.sample(o, 1, r) * 1.2 + 2.5; if (nnDist(y) > UNS) { off++; if (y < facts.train_min || y > facts.train_max) tail++; } } }
  facts.k1_tail_share = 100 * tail / off;
  ok('K = 1: every off-the-data sample lies below the lowest or above the highest training ending', tail === off, [tail, off]);
  ok('training endings reach 1.1 to 3.9 m only (the lesson says below 1.1 m or above 3.9 m)', facts.train_min > 1.05 && facts.train_min < 1.15 && facts.train_max > 3.85 && facts.train_max < 3.95, [facts.train_min, facts.train_max]);
}
facts.unsup_true = 100 * [-0.3, -0.2, -0.1, 0, 0.1, 0.2, 0.3].reduce((a, zp) => a + condSamples(zp).filter(s => nnDist(s[1]) > UNS).length, 0) / (300 * 7);   // real draws from the same seven readings the heads are scored on
for (const k of [10, 30]) facts['feed' + k + '_k3'] = 100 * (1 - Math.pow(1 - facts.unsup3 / 100, k));
facts.feed10_k1 = 100 * (1 - Math.pow(1 - facts.unsup1 / 100, 10));
/* reliability of P(up) */
function reliability(K) {
  const NB = 8, cnt = new Array(NB).fill(0), sp = new Array(NB).fill(0), so = new Array(NB).fill(0); let ece = 0, pm = 0, pv = 0;
  te.X.forEach((x, i) => { const m = CY.mdn.mixture(MDN[K].predict(x), K); let p = 0; for (let k = 0; k < K; k++) p += m.pi[k] * (1 - PHI((0 - m.mu[k]) / m.sg[k])); const b = Math.min(NB - 1, Math.floor(p * NB)); cnt[b]++; sp[b] += p; so[b] += te.Y[i] > 0 ? 1 : 0; pm += p / te.X.length; });
  te.X.forEach((x) => { const m = CY.mdn.mixture(MDN[K].predict(x), K); let p = 0; for (let k = 0; k < K; k++) p += m.pi[k] * (1 - PHI((0 - m.mu[k]) / m.sg[k])); pv += (p - pm) ** 2 / te.X.length; });
  for (let b = 0; b < NB; b++) if (cnt[b]) ece += cnt[b] / te.X.length * Math.abs(so[b] / cnt[b] - sp[b] / cnt[b]);
  return { ece, spread: Math.sqrt(pv) };
}
for (const K of [1, 2, 3]) { const r = reliability(K); facts['ece' + K] = 100 * r.ece; facts['res' + K] = 100 * r.spread; }
{ // the truth's own spread of P(up): by quadrature
  let pm = 0, pv = 0; const ps = te.X.map(x => condQuad(x[0] * 0.15).up + 0.5 * condQuad(x[0] * 0.15).mid); ps.forEach(p => pm += p / ps.length); ps.forEach(p => pv += (p - pm) ** 2 / ps.length); facts.res_true = 100 * Math.sqrt(pv);
}
/* ensembles of squared-error nets, trained on bootstrap resamples of the first NE launches */
function trainEnsemble(NE) {
  const nets = [];
  for (let m = 0; m < 5; m++) { const r = CY.rng(77 + m), X = [], Y = []; for (let i = 0; i < NE; i++) { const j = Math.floor(r() * NE); X.push(tr.X[j]); Y.push([tr.Y[j]]); } const net = new CY.MLP([1, H, H, 1], 11 + m); net.fit(X, Y, { epochs: EP, lr: 0.01, batch: Math.min(32, NE), seed: 3 + m }); nets.push(net); }
  return nets;
}
const ENS = { 40: trainEnsemble(40), 800: trainEnsemble(800) };
const ensAt = (NE, zp) => { const v = ENS[NE].map(n => n.predict([zp / 0.15])[0] * 1.2 + 2.5), m = CY.stats.mean(v); return { v, std: Math.sqrt(v.reduce((a, x) => a + (x - m) ** 2, 0) / v.length), mean: m }; };
facts.ens40_std0 = ensAt(40, 0).std; facts.ens800_std0 = ensAt(800, 0).std; facts.ens800_mean0 = ensAt(800, 0).mean;
facts.ens40_std_edge = ensAt(40, 0.45).std; facts.ens800_std_edge = ensAt(800, 0.45).std;
{ const cs = condSamples(0).map(s => s[1]); const m = CY.stats.mean(cs); facts.true_std0 = Math.sqrt(cs.reduce((a, y) => a + (y - m) ** 2, 0) / cs.length); facts.std_ratio800 = facts.true_std0 / facts.ens800_std0; facts.std_ratio40 = facts.true_std0 / facts.ens40_std0; }
ok('the ensemble spread is far smaller than the outcome spread at the fork (800 launches)', facts.std_ratio800 > 8, facts.std_ratio800);
ok('and grows when the data shrink (40 launches)', facts.ens40_std0 > 1.8 * facts.ens800_std0, [facts.ens40_std0, facts.ens800_std0]);
ok('and still stays far below the outcome spread', facts.std_ratio40 > 3, facts.std_ratio40);
facts.z_range = Math.max.apply(null, tr.X.map(x => Math.abs(x[0] * 0.15)));
/* checkpoint: two outcomes +/- d, probabilities pi and 1 - pi */
{ const d = 1, pi = 0.7; facts.ck_c = (2 * pi - 1) * d; facts.ck_loss = 4 * pi * (1 - pi) * d * d; facts.ck_loss_branch = (1 - pi) * (2 * d) ** 2; let best = Infinity, cb = 0; for (let c = -1.5; c <= 1.5; c += 0.0005) { const L = pi * (d - c) ** 2 + (1 - pi) * (d + c) ** 2; if (L < best) { best = L; cb = c; } } ok('checkpoint optimum by grid search', close(cb, facts.ck_c, 0.001) && close(best, facts.ck_loss, 0.001), [cb, best]); }
/* the lesson's constants */
facts.sb_cm = 100 * SB; facts.so_cm = 100 * SO;

/* ── 5. drive the page's widget ── */
const PAGE = path.join(DIR, '05_stochastic_futures_uncertainty.html'), HAVE_PAGE = fs.existsSync(PAGE);
ok('the lesson page exists', HAVE_PAGE);
const page = HAVE_PAGE ? loadPage(PAGE, { dpr: 1 }) : { problems: [], set() {}, num() { return NaN; }, text() { return ''; }, click() {} };
ok('page loads cleanly', page.problems.length === 0, page.problems.join(' | '));
if (HAVE_PAGE) {
  page.set('w05-ens', 'off');
  for (const K of [1, 2, 3, 4]) {
    page.set('w05-k', K); page.set('w05-z', 0);
    ok('widget NLL, K = ' + K, close(page.num('w05-nll'), facts['nll' + K], 0.0051), [page.num('w05-nll'), facts['nll' + K]]);
    ok('widget valley mass at z = 0, K = ' + K, close(page.num('w05-valley'), facts['valley' + K], 0.051), [page.num('w05-valley'), facts['valley' + K]]);
    ok('widget unsupported share (all z), K = ' + K, close(page.num('w05-uns'), facts['unsup' + K], 0.051), [page.num('w05-uns'), facts['unsup' + K]]);
  }
  page.set('w05-k', 3); page.set('w05-z', 0);
  ok('widget: the mixture-weights readout (K = 3, z = 0) lists the in-between weight', page.text('w05-pi').split('/').map(t => parseFloat(t)).some(w => Math.abs(w - facts.mid_w3) < 0.0051), [page.text('w05-pi'), facts.mid_w3]);
  ok('widget: squared-error prediction (height) at z = 0', close(page.num('w05-mse'), facts.mse_y0, 0.0051), [page.num('w05-mse'), facts.mse_y0]);
  ok('widget: distance from the squared-error point to the nearest true outcome', close(page.num('w05-near'), facts.mse_nearest, 0.0051), [page.num('w05-near'), facts.mse_nearest]);
  ok('widget: true share of outcomes in the post band', close(page.num('w05-truth'), facts.valley_true, 0.051), [page.num('w05-truth'), facts.valley_true]);
  page.set('w05-ens', 'n800'); page.set('w05-z', 0);
  ok('widget: ensemble spread at z = 0 (800 launches)', close(page.num('w05-es'), facts.ens800_std0, 0.0051), [page.num('w05-es'), facts.ens800_std0]);
  ok('widget: actual outcome spread at z = 0', close(page.num('w05-sd'), facts.true_std0, 0.0051), [page.num('w05-sd'), facts.true_std0]);
  page.set('w05-ens', 'n40');
  ok('widget: ensemble spread at z = 0 (40 launches)', close(page.num('w05-es'), facts.ens40_std0, 0.0051), [page.num('w05-es'), facts.ens40_std0]);
  page.set('w05-ens', 'off'); page.set('w05-k', 1);
  ok('widget: reliability error, K = 1', close(page.num('w05-ece'), facts.ece1, 0.051), [page.num('w05-ece'), facts.ece1]);
  page.set('w05-k', 3);
  ok('widget: reliability error, K = 3', close(page.num('w05-ece'), facts.ece3, 0.051), [page.num('w05-ece'), facts.ece3]);
}
ok('widget ran without errors', page.problems.length === 0, page.problems.join(' | '));
console.error(fails ? `${fails} check(s) FAILED` : 'all checks passed');
console.log(JSON.stringify({ facts }));
process.exit(fails ? 1 : 0);
