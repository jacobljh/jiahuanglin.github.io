#!/usr/bin/env node
/* Oracle for World Models lesson 14, "Actions without labels, worlds in real time".
 *
 * The lesson's numbers come from one experiment, a VIDEO OF THE COURTYARD whose player's presses were never recorded: at every step the player presses neutral (p = 1/2) or one of
 * eight compass directions (1/16 each), a push of 0.6 m/s; a frame is a reading of the state (position to 1 cm, velocity to 0.06 m/s).  Clips end when the ball comes within 0.4 m
 * of a wall, so no frame pair touches a wall until section 6.
 *
 * This oracle
 *   (1) re-implements the physics WITHOUT CY.step (a separate five-sub-step integrator), replays the video protocol with it and checks it against the engine's video;
 *   (2) re-derives the passive law, the unexplained push and its noise floor (closed forms against data), the inverse dynamics model (own normal equations), the latent action model
 *       (k-means restarts + own Lloyd; purity, entropy and mutual information from an own confusion table; the Bayes-optimal classifier as an upper bound), the invariance of every
 *       prediction under a relabelling of the codes, the coupon-collector count (inclusion-exclusion against simulation), naming curves over 300 orders of labelled examples;
 *   (3) controllability: closed forms (the Rayleigh and Rician means of two Gaussian draws) against simulation;
 *   (4) the n-pass sampler: an own implementation, the closed-form recursion for one Gaussian, the sampling-noise floor of the distance to the press rates, one pass = the mean;
 *   (5) latency and attention-pair arithmetic, the pair counts checked by enumerating masks;
 *   (6) section 6: the smooth model (own random-feature ridge), the contact error ratio, a 32 x 32 network as a robustness check, and 400 four-second sessions with an own integrator;
 *   (7) drives the page's own widget into every state the prose describes and compares what it prints.
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
const PI = Math.PI;

/* ── 1. an independent integrator for the plain Courtyard (walls only) ── */
const GAMMA = 0.35, DT = 0.1, SUB = 5, RB = 0.1, WALL_E = 0.9, AW = 8, AH = 5;
const DD = Math.exp(-GAMMA * DT), GG = (1 - DD) / GAMMA;                       // one step of friction: v' = d v, x' = x + g v
function stepI(s, a) {
  let x = s[0], y = s[1], vx = s[2], vy = s[3];
  if (a) { vx += a[0]; vy += a[1]; }
  const h = DT / SUB, damp = Math.exp(-GAMMA * h), glide = (1 - damp) / GAMMA;
  for (let i = 0; i < SUB; i++) {
    x += vx * glide; y += vy * glide; vx *= damp; vy *= damp;
    if (x < RB) { x = 2 * RB - x; vx = -WALL_E * vx; }
    if (x > AW - RB) { x = 2 * (AW - RB) - x; vx = -WALL_E * vx; }
    if (y < RB) { y = 2 * RB - y; vy = -WALL_E * vy; }
    if (y > AH - RB) { y = 2 * (AH - RB) - y; vy = -WALL_E * vy; }
  }
  return [x, y, vx, vy];
}
const W0 = CY.world({ curtain: null });
{
  const rng = CY.rng(11); let worst = 0;
  for (let n = 0; n < 400; n++) {
    let s = [0.3 + 7.4 * rng(), 0.3 + 4.4 * rng(), 6 * rng() - 3, 6 * rng() - 3], q = s.slice(), a = n % 3 === 0 ? [rng() - 0.5, rng() - 0.5] : null;
    for (let t = 0; t < 25; t++) { s = stepI(s, t === 0 ? a : null); q = CY.step(W0, q, t === 0 ? a : null); }
    for (let c = 0; c < 4; c++) worst = Math.max(worst, Math.abs(s[c] - q[c]));
  }
  ok('independent integrator == CY.step (400 trajectories, 25 steps, walls included)', worst < 1e-9, worst);
  facts.d_true = DD; facts.g_true = GG;
  facts.fric_pct = 100 * (1 - DD);
  // closed form: v' = d v, x' = x + g v in free flight, whatever the push (added first)
  const s = [4, 2.5, 0.8, -0.5], a = [0.3, 0.2], q = stepI(s, a);
  ok('free-flight law v\' = d (v + a), x\' = x + g (v + a)', close(q[2], DD * (s[2] + a[0]), 1e-12) && close(q[3], DD * (s[3] + a[1]), 1e-12) && close(q[0], s[0] + GG * (s[2] + a[0]), 1e-12) && close(q[1], s[1] + GG * (s[3] + a[1]), 1e-12));
}

/* ── 2. the video protocol (the lesson's section 1), replayed with the independent integrator ── */
const P0 = 0.5, M = 0.6, SX = 0.01, SV = 0.06, MARGIN = 0.4, TCLIP = 40, NV = 3600;
const sym = k => k < 0 ? [0, 0] : [M * Math.cos(k * PI / 4), M * Math.sin(k * PI / 4)];
function videoI(seed, n, walls) {
  const rng = CY.rng(seed), rows = []; let clip = 0;
  while (rows.length < n) {
    let s = [1 + 6 * rng(), 1 + 3 * rng(), 0.6 * CY.randn(rng), 0.6 * CY.randn(rng)];
    for (let t = 0; t < TCLIP && rows.length < n; t++) {
      const u = rng(); let k = -1; if (u >= P0) k = Math.min(7, Math.floor((u - P0) / (1 - P0) * 8));
      const a = sym(k), s2 = stepI(s, k < 0 ? null : a);
      const free = [s[0] + GG * (s[2] + a[0]), s[1] + GG * (s[3] + a[1]), DD * (s[2] + a[0]), DD * (s[3] + a[1])];
      const contact = [0, 1, 2, 3].some(c => Math.abs(s2[c] - free[c]) > 1e-9);
      const rd = st => [st[0] + SX * CY.randn(rng), st[1] + SX * CY.randn(rng), st[2] + SV * CY.randn(rng), st[3] + SV * CY.randn(rng)];
      const z = rd(s), z2 = rd(s2);
      rows.push({ s, s2, z, z2, k, a, contact, clip });
      s = s2;
      if (!walls && (s[0] < MARGIN || s[0] > AW - MARGIN || s[1] < MARGIN || s[1] > AH - MARGIN)) break;
    }
    clip++;
  }
  return rows;
}
const L14 = require(path.join(DIR, 'l14_action.js'));                                // the engine under test: used only to compare, never to produce a fact
const V1 = videoI(1, NV), V2 = videoI(2, NV);
{
  const E1 = L14.video(1, NV); let worst = 0, kdiff = 0;
  V1.forEach((r, i) => { const e = E1[i]; for (let c = 0; c < 4; c++) worst = Math.max(worst, Math.abs(r.z[c] - e.z[c]), Math.abs(r.z2[c] - e.z2[c]), Math.abs(r.s2[c] - e.s2[c])); if (r.k !== e.k) kdiff++; });
  ok('engine video == oracle video (same seeds, own integrator)', E1.length === V1.length && worst < 1e-9 && kdiff === 0, [worst, kdiff]);
}
facts.n_pairs = V1.length; facts.n_clips = V1[V1.length - 1].clip + 1;
facts.n_contact_video = V1.filter(r => r.contact).length;
ok('no frame pair of the video touches a wall (clips are cut 0.4 m before)', facts.n_contact_video === 0 && V2.every(r => !r.contact));
facts.neutral_pct = 100 * V1.filter(r => r.k < 0).length / V1.length;
facts.mean_clip_len = V1.length / facts.n_clips;
{ // speed of the ball in the video
  const sp = V1.reduce((a, r) => a + Math.hypot(r.s[2], r.s[3]), 0) / V1.length; facts.mean_speed = sp;
}

/* the passive law, fitted by least squares from the unlabelled video; the unexplained push; its noise floor */
function passiveI(rows) {
  const v = [], v2 = [], dx = []; rows.forEach(r => { for (let q = 0; q < 2; q++) { v.push(r.z[2 + q]); v2.push(r.z2[2 + q]); dx.push(r.z2[q] - r.z[q]); } });
  let a = 0, b = 0, c = 0; for (let i = 0; i < v.length; i++) { a += v[i] * v[i]; b += v[i] * v2[i]; c += v[i] * dx[i]; }
  return { d: b / a, g: c / a };
}
const PAS = passiveI(V1), PAS2 = passiveI(V2);
facts.dhat = PAS.d; facts.ghat = PAS.g;
ok('fitted d is within 1 % of exp(-gamma dt)', Math.abs(PAS.d / DD - 1) < 0.01, [PAS.d, DD]);
ok('fitted g is within 1 % of (1 - d) / gamma', Math.abs(PAS.g / GG - 1) < 0.01, [PAS.g, GG]);
facts.dhat_gap_pct = 100 * (1 - PAS.d / DD);
const uI = (r, pas) => [r.z2[2] / pas.d - r.z[2], r.z2[3] / pas.d - r.z[3]];
const U1 = V1.map(r => uI(r, PAS)), U2 = V2.map(r => uI(r, PAS));
{
  let e = 0, m2 = 0; V1.forEach((r, i) => { e += (U1[i][0] - r.a[0]) ** 2 + (U1[i][1] - r.a[1]) ** 2; m2 += r.a[0] ** 2 + r.a[1] ** 2; });
  facts.floor_axis = Math.sqrt(e / V1.length / 2);
  facts.floor_formula = SV * Math.sqrt(1 + DD * DD) / DD;                         // the push is read as v'/d - v: noise variance sigma_v^2 (1/d^2 + 1)
  ok('noise floor per axis: data vs closed form sigma_v sqrt(1 + d^2) / d (2 %)', Math.abs(facts.floor_axis / facts.floor_formula - 1) < 0.02, [facts.floor_axis, facts.floor_formula]);
  facts.rms_push = Math.sqrt(m2 / V1.length); facts.rms_push_formula = M * Math.sqrt(1 - P0);
  ok('rms push sqrt(E|a|^2) = M sqrt(1 - P0)', Math.abs(facts.rms_push / facts.rms_push_formula - 1) < 0.03, [facts.rms_push, facts.rms_push_formula]);
  facts.floor_comb = facts.floor_axis * Math.SQRT2;                                    // the floor of the combined (2-D) push error
  const meanU = [0, 1].map(q => U1.reduce((a, u) => a + u[q], 0) / U1.length);
  facts.unexpl = Math.sqrt(U1.reduce((a, u) => a + (u[0] - meanU[0]) ** 2 + (u[1] - meanU[1]) ** 2, 0) / U1.length);   // spread of the unexplained push, both axes (= the K = 1 decoder error)
}
facts.entropy_a = (() => { const p = [P0].concat(Array(8).fill((1 - P0) / 8)); return -p.reduce((a, q) => a + q * Math.log2(q), 0); })();
{ // the sampling bill of lesson 11's tokens: one 256-token frame drawn token by token at 24 fps
  facts.frame_ms = 1000 / 24; facts.tok256_ms = 1000 / 24 / 256;
}

/* ── 3. the inverse dynamics model: ridge regression on the two frames, own normal equations ── */
function solve(A, b, n) {                                  // Gauss-Jordan with partial pivoting on the augmented system
  const M2 = A.map((r, i) => r.concat(b[i]));
  for (let i = 0; i < n; i++) {
    let p = i; for (let k = i + 1; k < n; k++) if (Math.abs(M2[k][i]) > Math.abs(M2[p][i])) p = k;
    [M2[i], M2[p]] = [M2[p], M2[i]];
    const d = M2[i][i]; for (let j = i; j < M2[i].length; j++) M2[i][j] /= d;
    for (let k = 0; k < n; k++) if (k !== i) { const f = M2[k][i]; if (f) for (let j = i; j < M2[k].length; j++) M2[k][j] -= f * M2[i][j]; }
  }
  return M2.map(r => r.slice(n));
}
function idmFitI(rows, idx) {                              // W = (X'X + lambda I)^-1 X'Y, X = [z, z', 1] (9 columns), Y = push (2 columns)
  const p = 9, A = Array.from({ length: p }, (_, i) => Array(p).fill(0).map((_, j) => (i === j ? 1e-3 : 0))), B = Array.from({ length: p }, () => [0, 0]);
  for (const j of idx) { const r = rows[j], x = r.z.concat(r.z2, [1]); for (let a = 0; a < p; a++) { for (let b = 0; b < p; b++) A[a][b] += x[a] * x[b]; B[a][0] += x[a] * r.a[0]; B[a][1] += x[a] * r.a[1]; } }
  return solve(A, B, p);
}
function nearestButton(a) { let bi = -1, bd = Math.hypot(a[0], a[1]); for (let k = 0; k < 8; k++) { const s = sym(k), d = Math.hypot(a[0] - s[0], a[1] - s[1]); if (d < bd) { bd = d; bi = k; } } return bi; }
function idmScoreI(W, rows) {
  let e = 0, hit = 0;
  for (const r of rows) {
    let a = [0, 0]; if (W) { const x = r.z.concat(r.z2, [1]); for (let j = 0; j < 9; j++) { a[0] += x[j] * W[j][0]; a[1] += x[j] * W[j][1]; } }
    e += (a[0] - r.a[0]) ** 2 + (a[1] - r.a[1]) ** 2; if (nearestButton(a) === r.k) hit++;
  }
  return { rmse: Math.sqrt(e / rows.length), acc: hit / rows.length };
}
const IDX_ALL = V1.map((_, i) => i);
{
  const all = idmScoreI(idmFitI(V1, IDX_ALL), V2); facts.idm_floor = all.rmse; facts.idm_acc_all = 100 * all.acc;
  ok('the IDM trained on every label reaches the noise floor (within 12 % of sqrt(2) x per-axis floor, and not below Bayes)', all.rmse < facts.floor_comb * 1.02 && all.rmse > facts.floor_comb * 0.8, [all.rmse, facts.floor_comb]);
  const none = idmScoreI(null, V2); facts.causal_rmse = none.rmse; facts.causal_acc = 100 * none.acc;
  facts.causal_ratio = none.rmse / all.rmse;
  ok('a predictor that cannot see the next frame is off by the spread of the pushes', close(none.rmse, facts.rms_push_formula, 0.02), [none.rmse, facts.rms_push_formula]);
  const eng = L14.idmScore(L14.idmFit(V1, IDX_ALL), V2); ok('engine IDM == oracle IDM', close(eng.rmse, all.rmse, 1e-6) && close(eng.acc, all.acc, 1e-12), [eng, all]);
}
const NS = [0, 1, 2, 3, 4, 5, 6, 8, 9, 10, 12, 15, 20, 25, 30, 40, 50, 60, 80, 100, 150, 200];
const orderOf = seed => CY.shuffle(V1.map((_, i) => i), CY.rng(seed));
const SEEDS = []; for (let s = 100; s < 400; s++) SEEDS.push(s);
const idmMean = {}, idmWidget = {};
{
  const ORD = SEEDS.map(orderOf);
  for (const n of NS) { let rm = 0, ac = 0; for (const o of ORD) { const e = idmScoreI(n ? idmFitI(V1, o.slice(0, n)) : null, V2); rm += e.rmse / ORD.length; ac += e.acc / ORD.length; } idmMean[n] = { rmse: rm, acc: ac }; }
  const o321 = orderOf(321); for (const n of NS) idmWidget[n] = idmScoreI(n ? idmFitI(V1, o321.slice(0, n)) : null, V2);
  for (const n of [3, 9, 10, 20, 30]) { facts['idm_rmse_n' + n] = idmMean[n].rmse; facts['idm_acc_n' + n] = 100 * idmMean[n].acc; }
  facts.idm_rmse_n20_w = idmWidget[20].rmse; facts.idm_rmse_n10_w = idmWidget[10].rmse; facts.idm_acc_n20_w = 100 * idmWidget[20].acc;
  ok('with 3 labelled pairs the IDM is worse than guessing "no push" (mean over 300 orders)', idmMean[3].rmse > facts.causal_rmse, [idmMean[3].rmse, facts.causal_rmse]);
  ok('with 20 labelled pairs the IDM is within 40 % of its floor', idmMean[20].rmse < 1.4 * all_floor(), [idmMean[20].rmse, all_floor()]);
}
function all_floor() { return facts.idm_floor; }
facts.vpt_ratio = 70000 / 1962;                           // hours of video labelled by the IDM per hour of labelled contractor data (VPT: ~70k h from 1,962 h)
facts.vpt_ratio100 = 70000 / 100;

/* ── 4. the latent action model: k-means on the unexplained push ── */
function lloydI(U, C, iters) {
  const K = C.length; let assign = new Array(U.length).fill(0), inertia = 0;
  C = C.map(c => c.slice());
  for (let it = 0; it < iters; it++) {
    const sum = C.map(() => [0, 0]), cnt = new Array(K).fill(0); inertia = 0;
    U.forEach((u, i) => { let b = 0, bd = Infinity; for (let k = 0; k < K; k++) { const d = (u[0] - C[k][0]) ** 2 + (u[1] - C[k][1]) ** 2; if (d < bd) { bd = d; b = k; } } assign[i] = b; inertia += bd; sum[b][0] += u[0]; sum[b][1] += u[1]; cnt[b]++; });
    for (let k = 0; k < K; k++) if (cnt[k]) C[k] = [sum[k][0] / cnt[k], sum[k][1] / cnt[k]];
  }
  return { C, assign, inertia };
}
function lamI(U, K, restarts) {
  let best = null;
  for (let sd = 1; sd <= restarts; sd++) { const km = CY.kmeans(U, K, { seed: sd, iters: 10 }); if (!best || km.inertia < best.inertia) best = km; }
  const fin = lloydI(U, Array.from(best.centers, c => [c[0], c[1]]), 25), cnt = new Array(K).fill(0), s2 = new Array(K).fill(0);
  fin.assign.forEach((c, i) => { cnt[c]++; s2[c] += (U[i][0] - fin.C[c][0]) ** 2 + (U[i][1] - fin.C[c][1]) ** 2; });
  return { K, centers: fin.C, assign: fin.assign, inertia: fin.inertia, rms: Math.sqrt(fin.inertia / U.length / 2), pi: cnt.map(c => c / U.length), sd: s2.map((v, j) => cnt[j] ? Math.sqrt(v / cnt[j] / 2) : 0) };
}
function tableI(assign, rows, K) { const t = Array.from({ length: K }, () => Array(9).fill(0)); assign.forEach((c, i) => { t[c][rows[i].k + 1]++; }); return t; }
function infoI(t) {
  const K = t.length, n = t.reduce((a, r) => a + r.reduce((x, y) => x + y, 0), 0), pc = t.map(r => r.reduce((a, b) => a + b, 0)), pa = Array(9).fill(0).map((_, a) => t.reduce((s, r) => s + r[a], 0));
  const H = ps => -ps.filter(x => x > 0).reduce((a, x) => a + (x / n) * Math.log2(x / n), 0);
  let I = 0; for (let c = 0; c < K; c++) for (let a = 0; a < 9; a++) if (t[c][a]) I += t[c][a] / n * Math.log2(t[c][a] * n / (pc[c] * pa[a]));
  return { purity: t.reduce((s, r) => s + Math.max(...r), 0) / n, Hc: H(pc), Ha: H(pa), I };
}
const LAM = {};
for (const K of [1, 2, 3, 4, 6, 8, 9, 10, 12, 16, 32, 64]) {
  const lam = lamI(U1, K, 12), st = infoI(tableI(lam.assign, V1, K)); LAM[K] = { lam, st };
  facts['dist_K' + K] = lam.rms * Math.SQRT2; facts['pur_K' + K] = 100 * st.purity; facts['Hc_K' + K] = st.Hc; facts['I_K' + K] = st.I; facts['bits_K' + K] = Math.log2(K);
}
facts.Ha = LAM[9].st.Ha;
ok('action entropy Ha equals the closed form', close(facts.Ha, facts.entropy_a, 0.05), [facts.Ha, facts.entropy_a]);
ok('K = 9: the decoder error is at the noise floor (within 4 %)', Math.abs(facts.dist_K9 / facts.floor_comb - 1) < 0.04, [facts.dist_K9, facts.floor_comb]);
ok('K = 9: purity above 99 %; K = 8 merges two buttons (below 95 %)', facts.pur_K9 > 99 && facts.pur_K8 < 95, [facts.pur_K9, facts.pur_K8]);
ok('K = 9: the code carries (almost) all the action entropy, I >= 0.98 Ha', facts.I_K9 > 0.98 * facts.Ha, [facts.I_K9, facts.Ha]);
ok('K > 9: distortion falls below the noise floor (leak) and the code entropy exceeds the action entropy', [10, 12, 16, 32, 64].every(K => facts['dist_K' + K] < facts.floor_comb && facts['Hc_K' + K] > facts.Ha + 0.3), [10, 12, 16, 32, 64].map(K => [facts['dist_K' + K], facts['Hc_K' + K]]));
ok('K > 9: information about the button does not grow (I <= Ha + 0.01)', [10, 12, 16, 32, 64].every(K => facts['I_K' + K] <= facts.Ha + 0.01));
ok('distortion decreases with K', [1, 2, 3, 4, 6, 8, 9, 10, 12, 16, 32, 64].every((K, i, a) => i === 0 || facts['dist_K' + K] < facts['dist_K' + a[i - 1]]));
facts.leak64 = facts.Hc_K64 - facts.I_K64;                // bits of the 64-code carrying something other than the button
facts.leak_pct_K64 = 100 * (1 - facts.dist_K64 / facts.floor_comb);
{ // engine's LAM == oracle's LAM
  const E = L14.lam(U1.map(u => u.slice()), 9), o = LAM[9].lam; let worst = 0; E.centers.forEach((c, k) => { worst = Math.max(worst, Math.abs(c[0] - o.centers[k][0]), Math.abs(c[1] - o.centers[k][1])); });
  ok('engine LAM centres == oracle LAM centres (K = 9)', worst < 1e-9, worst);
  const Ue = L14.unexplained(V1, L14.fitPassive(V1)); let w2 = 0; Ue.forEach((u, i) => { w2 = Math.max(w2, Math.abs(u[0] - U1[i][0]), Math.abs(u[1] - U1[i][1])); }); ok('engine unexplained push == oracle', w2 < 1e-12, w2);
}
{ // one random start against the best of twelve (the local optima of k-means)
  const one = lamI(U1, 9, 1), st1 = infoI(tableI(one.assign, V1, 9)); facts.pur_K9_one = 100 * st1.purity; facts.inertia_K9_one = one.inertia; facts.inertia_K9_best = LAM[9].lam.inertia;
  ok('a single k-means start ends in a worse arrangement than twelve starts (K = 9)', one.inertia > LAM[9].lam.inertia * 1.02 && st1.purity < LAM[9].st.purity - 0.02, [one.inertia, LAM[9].lam.inertia, st1.purity]);
}
{ // the Bayes-optimal nine-way classifier of the unexplained push (known button vectors, known noise): an upper bound on purity
  const s2 = facts.floor_axis ** 2, pr = [P0].concat(Array(8).fill((1 - P0) / 8)); let hit = 0;
  U1.forEach((u, i) => { let bi = -1, bl = -Infinity; for (let k = -1; k < 8; k++) { const c = sym(k), l = Math.log(pr[k + 1]) - ((u[0] - c[0]) ** 2 + (u[1] - c[1]) ** 2) / (2 * s2); if (l > bl) { bl = l; bi = k; } } if (bi === V1[i].k) hit++; });
  facts.bayes_pct = 100 * hit / V1.length; ok('the latent action model is within 0.6 point of the Bayes classifier (K = 9)', Math.abs(facts.bayes_pct - facts.pur_K9) < 0.6, [facts.bayes_pct, facts.pur_K9]);
}
{ // the codes ARE the buttons: every true button vector has a code centre within 0.05 m/s, up to a permutation
  const o = LAM[9].lam; let worst = 0;
  for (let k = -1; k < 8; k++) { const c = sym(k); worst = Math.max(worst, Math.min(...o.centers.map(q => Math.hypot(q[0] - c[0], q[1] - c[1])))); }
  facts.centre_gap = worst; ok('every one of the nine buttons has a code centre within 0.05 m/s', worst < 0.05, worst);
}
{ // relabelling the codes changes no prediction: permute the centres and the code numbers together, decode both ways
  const o = LAM[9].lam, K = 9, rng = CY.rng(77), perm = CY.shuffle(Array.from({ length: K }, (_, i) => i), rng);
  const cen2 = new Array(K); perm.forEach((p, k) => { cen2[p] = o.centers[k]; });
  let worst = 0;
  V1.forEach((r, i) => { const c = o.assign[i], c2 = perm[c], pa = [DD * (r.z[2] + o.centers[c][0]), DD * (r.z[3] + o.centers[c][1])], pb = [DD * (r.z[2] + cen2[c2][0]), DD * (r.z[3] + cen2[c2][1])]; worst = Math.max(worst, Math.abs(pa[0] - pb[0]), Math.abs(pa[1] - pb[1])); });
  facts.perm_maxdiff = worst; ok('permuting the codes changes no prediction (exactly)', worst === 0, worst);
  facts.fact9 = 362880; ok('9! = 362880', [1, 2, 3, 4, 5, 6, 7, 8, 9].reduce((a, b) => a * b, 1) === 362880);
}

/* ── 5. naming the codes: coupon collector, naming curves over 300 orders of labelled pairs ── */
const lam9 = LAM[9].lam, codes9te = U2.map(u => { let b = 0, bd = Infinity; lam9.centers.forEach((c, k) => { const d = (u[0] - c[0]) ** 2 + (u[1] - c[1]) ** 2; if (d < bd) { bd = d; b = k; } }); return b; });
function namesI(lam, rows, order, n) {
  const t = lam.centers.map(() => Array(9).fill(0)); for (let i = 0; i < n; i++) t[lam.assign[order[i]]][rows[order[i]].k + 1]++;
  return t.map(r => { const s = r.reduce((a, b) => a + b, 0); if (!s) return null; let bi = 0; r.forEach((v, a) => { if (v > r[bi]) bi = a; }); return bi - 1; });
}
function scoreNamesI(lam, names, rows, codes) {
  let ok_ = 0, e = 0; rows.forEach((r, i) => { const nm = names[codes[i]] === null ? -1 : names[codes[i]], p = sym(nm); if (nm === r.k) ok_++; e += (p[0] - r.a[0]) ** 2 + (p[1] - r.a[1]) ** 2; });
  let right = 0; for (let k = 0; k < 8; k++) { const d = sym(k); if (names.some((nm, c) => nm === k && lam.centers[c][0] * d[0] + lam.centers[c][1] * d[1] > Math.cos(PI / 8) * Math.hypot(...lam.centers[c]) * M && Math.hypot(...lam.centers[c]) > 0.5 * M)) right++; }
  return { acc: ok_ / rows.length, rmse: Math.sqrt(e / rows.length), right };
}
function couponI(p) { let E = 0; const K = p.length; for (let m = 1; m < (1 << K); m++) { let s = 0, b = 0; for (let c = 0; c < K; c++) if (m & (1 << c)) { s += p[c]; b++; } E += (b % 2 ? 1 : -1) / s; } return E; }
{
  const p = lam9.pi; facts.coupon = couponI([P0].concat(Array(8).fill((1 - P0) / 8)));
  const H8 = [1, 2, 3, 4, 5, 6, 7, 8].reduce((a, k) => a + 1 / k, 0); facts.coupon_approx = 16 * H8; facts.H8 = H8;
  facts.coupon_data = couponI(p);
  const rng = CY.rng(5); let tot = 0; const R = 20000, cum = []; { let a = 0; for (const q of [P0].concat(Array(8).fill((1 - P0) / 8))) { a += q; cum.push(a); } }
  for (let r = 0; r < R; r++) { const seen = new Set(); let n = 0; while (seen.size < 9) { const u = rng(); seen.add(cum.findIndex(c => u <= c)); n++; } tot += n; }
  facts.coupon_mc = tot / R; ok('coupon-collector: inclusion-exclusion vs simulation (2 %)', Math.abs(facts.coupon_mc / facts.coupon - 1) < 0.02, [facts.coupon_mc, facts.coupon]);
  ok('coupon-collector: 16 H_8 is within 1 label of the exact count', Math.abs(facts.coupon_approx - facts.coupon) < 1.0, [facts.coupon_approx, facts.coupon]);
  { // the checkpoint's variant: neutral 0.7, eight buttons 0.0375 each
    const p2 = [0.7].concat(Array(8).fill(0.0375)); facts.ck_coupon = couponI(p2); facts.ck_coupon_approx = (1 / 0.0375) * H8;
  }
}
const curve = { R: {}, mean: {} };
{
  const ORD = SEEDS.map(orderOf);
  for (const n of NS) { let acc = 0, rm = 0, rt = 0; for (const o of ORD) { const s = scoreNamesI(lam9, namesI(lam9, V1, o, n), V2, codes9te); acc += s.acc / ORD.length; rm += s.rmse / ORD.length; rt += s.right / ORD.length; } curve.mean[n] = { acc, rmse: rm, right: rt }; }
  const o321 = orderOf(321); for (const n of NS) curve.R[n] = scoreNamesI(lam9, namesI(lam9, V1, o321, n), V2, codes9te);
  for (const n of [0, 9, 20, 40, 60]) { facts['named_mean_n' + n] = 100 * curve.mean[n].acc; facts['right_mean_n' + n] = curve.mean[n].right; facts['maperr_mean_n' + n] = curve.mean[n].rmse; }
  { const nm = namesI(lam9, V1, o321, 20); facts.unnamed_w_n20 = nm.filter(x => x === null).length; facts.named_codes_w_n20 = 9 - facts.unnamed_w_n20; }
  for (const n of [0, 5, 9, 10, 15, 20, 30, 40, 60]) { facts['named_w_n' + n] = 100 * curve.R[n].acc; facts['right_w_n' + n] = curve.R[n].right; facts['maperr_w_n' + n] = curve.R[n].rmse; }
  ok('at zero labels every code is read as "no push": accuracy = the neutral share', close(100 * curve.R[0].acc, 100 * V2.filter(r => r.k < 0).length / V2.length, 1e-9));
  ok('named accuracy rises with the labels (mean over orders, non-decreasing)', NS.every((n, i) => i === 0 || curve.mean[n].acc >= curve.mean[NS[i - 1]].acc - 1e-9));
  ok('the widget order (seed 321) is typical: within 8 points of the mean curve at every n', NS.every(n => Math.abs(curve.R[n].acc - curve.mean[n].acc) < 0.08), NS.map(n => [n, curve.R[n].acc, curve.mean[n].acc]));
  // guided labels: one pair per code, nearest its centre, biggest codes first, then the random order
  const picks = []; { const idx = lam9.centers.map((_, c) => c).sort((a, b) => lam9.pi[b] - lam9.pi[a]);
    for (const c of idx) { let bi = -1, bd = Infinity; U1.forEach((u, i) => { if (lam9.assign[i] === c) { const d = Math.hypot(u[0] - lam9.centers[c][0], u[1] - lam9.centers[c][1]); if (d < bd) { bd = d; bi = i; } } }); picks.push(bi); } }
  const gord = picks.concat(o321.filter(j => !picks.includes(j)));
  for (const n of [1, 5, 9]) { const s = scoreNamesI(lam9, namesI(lam9, V1, gord, n), V2, codes9te); facts['guided_acc_n' + n] = 100 * s.acc; facts['guided_right_n' + n] = s.right; facts['guided_maperr_n' + n] = s.rmse; }
  ok('nine guided labels name every button (accuracy >= 99 %, 8 of 8 right)', facts.guided_acc_n9 > 99 && facts.guided_right_n9 === 8, [facts.guided_acc_n9, facts.guided_right_n9]);
  ok('nine random labels name fewer than that (mean accuracy < 80 %)', facts.named_mean_n9 < 80);
  // the engine's own guided order must agree
  const E = L14.lam(U1.map(u => u.slice()), 9), ge = L14.guidedOrder(E, U1, o321); ok('engine guided order == oracle guided order (first 9)', ge.slice(0, 9).every((j, i) => j === gord[i]), [ge.slice(0, 9), gord.slice(0, 9)]);
}
{ // the error of the best possible naming: every code named by its true majority (all labels)
  const names = namesI(lam9, V1, IDX_ALL, V1.length), s = scoreNamesI(lam9, names, V2, codes9te); facts.map_err_codes = s.rmse; facts.named_acc_all = 100 * s.acc; facts.right_all = s.right;
  ok('with every label the named codes read the button right 99.5 %+ of the time', s.acc > 0.995, s.acc);
}

/* ── 6. controllability: between two buttons against two draws of one button (lesson 11's definition) ── */
function ricianMean(nu, s) {                        // E|N(nu e1, s^2 I2)|, by Simpson integration of r f(r); f uses the scaled Bessel function exp(-x) I0(x) (Abramowitz-Stegun 9.8.1, 9.8.2)
  const I0e = x => {
    if (x < 3.75) { const t = (x / 3.75) ** 2; return Math.exp(-x) * (1 + t * (3.5156229 + t * (3.0899424 + t * (1.2067492 + t * (0.2659732 + t * (0.0360768 + t * 0.0045813)))))); }
    const t = 3.75 / x; return (0.39894228 + t * (0.01328592 + t * (0.00225319 + t * (-0.00157565 + t * (0.00916281 + t * (-0.02057706 + t * (0.02635537 + t * (-0.01647633 + t * 0.00392377)))))))) / Math.sqrt(x);
  };
  const rmax = nu + 9 * s, n = 4000, h = rmax / n; let acc = 0;
  for (let i = 0; i <= n; i++) { const r = i * h, f = (r / (s * s)) * Math.exp(-((r - nu) ** 2) / (2 * s * s)) * I0e(r * nu / (s * s) + 1e-300), w = i === 0 || i === n ? 1 : (i % 2 ? 4 : 2); acc += w * r * f; }
  return acc * h / 3;
}
function controlClosed(lam) {
  const K = lam.centers.length; let bt = 0, wn = 0;
  for (let c = 0; c < K; c++) { wn += lam.sd[c] * Math.sqrt(PI) / K; for (let c2 = 0; c2 < K; c2++) if (c2 !== c) { const nu = Math.hypot(lam.centers[c][0] - lam.centers[c2][0], lam.centers[c][1] - lam.centers[c2][1]), s = Math.sqrt(lam.sd[c] ** 2 + lam.sd[c2] ** 2); bt += ricianMean(nu, s) / (K * (K - 1)); } }
  return { between: bt, within: wn, ratio: bt / wn };
}
function controlI(lam, N, seed, told) {              // the same protocol as the widget (N trials, seed), written out again
  const rng = CY.rng(seed), K = lam.centers.length; let bt = 0, wn = 0;
  const draw = c => { const x = lam.centers[c][0] + lam.sd[c] * CY.randn(rng), y = lam.centers[c][1] + lam.sd[c] * CY.randn(rng); return [x, y]; };
  const free = () => { const u = rng(); let acc = 0, c = 0; for (; c < K; c++) { acc += lam.pi[c]; if (u <= acc) break; } return draw(Math.min(c, K - 1)); };
  for (let i = 0; i < N; i++) {
    const c1 = Math.floor(rng() * K), c2 = (c1 + 1 + Math.floor(rng() * (K - 1))) % K;
    let a, b, w1, w2;
    if (told) { a = draw(c1); b = draw(c2); w1 = draw(c1); w2 = draw(c1); } else { a = free(); b = free(); w1 = free(); w2 = free(); }
    bt += Math.hypot(a[0] - b[0], a[1] - b[1]) / N; wn += Math.hypot(w1[0] - w2[0], w1[1] - w2[1]) / N;
  }
  return { between: bt, within: wn, ratio: bt / wn };
}
for (const K of [4, 8, 9, 12]) {
  const lam = LAM[K].lam, cl = controlClosed(lam), mc = controlI(lam, 4000, 7, true);
  facts['ctl_between_K' + K] = mc.between; facts['ctl_within_K' + K] = mc.within; facts['ctl_ratio_K' + K] = mc.ratio; facts['ctl_closed_K' + K] = cl.ratio;
  ok('controllability, K = ' + K + ': 4000-trial simulation vs the closed form (Rayleigh and Rician means) (6 %)', Math.abs(mc.ratio / cl.ratio - 1) < 0.06, [mc.ratio, cl.ratio]);
  const eng = L14.control(L14.mix(L14.lam(U1.map(u => u.slice()), K)), 4000, 7, true); ok('engine controllability == oracle controllability (K = ' + K + ')', close(eng.ratio, mc.ratio, 1e-9), [eng.ratio, mc.ratio]);
}
{
  const mc = controlI(lam9, 4000, 7, false), eng = L14.control(L14.mix(L14.lam(U1.map(u => u.slice()), 9)), 4000, 7, false); facts.ctl_free = mc.ratio;
  ok('engine free controllability == oracle', close(eng.ratio, mc.ratio, 1e-9), [eng.ratio, mc.ratio]);
  const big = controlI(lam9, 200000, 17, false); facts.ctl_free_big = big.ratio;
  ok('a model that ignores the button: between and within spreads are equal (ratio 1 +- 0.03, 200000 trials)', Math.abs(big.ratio - 1) < 0.03, big.ratio);
  // the true buttons' spread: distance between pushes of two different buttons, over the same pairs
  let tb = 0, cnt = 0; for (let a = -1; a < 8; a++) for (let b = -1; b < 8; b++) if (a !== b) { tb += Math.hypot(sym(a)[0] - sym(b)[0], sym(a)[1] - sym(b)[1]); cnt++; } facts.ctl_true_between = tb / cnt;
  ok('the model\'s between-button distance is within 6 % of the real one', Math.abs(facts.ctl_between_K9 / facts.ctl_true_between - 1) < 0.06, [facts.ctl_between_K9, facts.ctl_true_between]);
}

/* ── 7. the sampler: n passes of Euler steps with the exact denoiser ── */
const SMAX = 1.5, SMIN = 0.02, RHO = 7;
const mix9 = { pi: lam9.pi, mu: lam9.centers, sd: lam9.sd };
function denoiseI(mix, x, sg) {
  const K = mix.pi.length, logw = mix.pi.map((p, k) => { const v = mix.sd[k] ** 2 + sg * sg; return Math.log(p) - Math.log(v) - ((x[0] - mix.mu[k][0]) ** 2 + (x[1] - mix.mu[k][1]) ** 2) / (2 * v); });
  const mx = Math.max(...logw), w = logw.map(l => Math.exp(l - mx)), Z = w.reduce((a, b) => a + b, 0); let o = [0, 0];
  for (let k = 0; k < K; k++) { const sh = mix.sd[k] ** 2 / (mix.sd[k] ** 2 + sg * sg); o[0] += w[k] / Z * (mix.mu[k][0] + sh * (x[0] - mix.mu[k][0])); o[1] += w[k] / Z * (mix.mu[k][1] + sh * (x[1] - mix.mu[k][1])); }
  return o;
}
const sigmasI = n => { const s = []; for (let i = 0; i < n; i++) { const t = n === 1 ? 0 : i / (n - 1); s.push((SMAX ** (1 / RHO) + t * (SMIN ** (1 / RHO) - SMAX ** (1 / RHO))) ** RHO); } s.push(0); return s; };
function sampleI(mix, n, N, seed) {
  const rng = CY.rng(seed), sg = sigmasI(n), out = [];
  for (let j = 0; j < N; j++) { let x = [SMAX * CY.randn(rng), SMAX * CY.randn(rng)]; for (let i = 0; i < n; i++) { const d = denoiseI(mix, x, sg[i]); x = [x[0] + (sg[i + 1] - sg[i]) * (x[0] - d[0]) / sg[i], x[1] + (sg[i + 1] - sg[i]) * (x[1] - d[1]) / sg[i]]; } out.push(x); }
  return out;
}
function modeStatsI(mix, xs) {
  const K = mix.pi.length, h = Array(K).fill(0); let off = 0;
  for (const x of xs) { const d = mix.mu.map(m => Math.hypot(x[0] - m[0], x[1] - m[1])), b = d.indexOf(Math.min(...d)); h[b]++; if (d[b] > 3 * mix.sd[b]) off++; }
  return { covered: h.filter(v => v > 0).length, tv: h.reduce((a, v, k) => a + Math.abs(v / xs.length - mix.pi[k]) / 2, 0), off: off / xs.length, h };
}
const NP = [1, 2, 3, 4, 6, 8, 16, 32];
for (const n of NP) {
  const xs = sampleI(mix9, n, 2000, 5), st = modeStatsI(mix9, xs);
  facts['modes_n' + n] = st.covered; facts['tv_n' + n] = st.tv; facts['off_n' + n] = 100 * st.off;
  if (n <= 8) { const E = L14.modeStats(L14.mix(L14.lam(U1.map(u => u.slice()), 9)), L14.sample(L14.mix(L14.lam(U1.map(u => u.slice()), 9)), n, 2000, 5)); ok('engine sampler == oracle sampler (n = ' + n + ')', E.covered === st.covered && close(E.tv, st.tv, 1e-9), [E, st]); }
}
{ // one pass is the conditional mean: every draw is (almost) the denoiser at the largest noise level, a point at the mean of the mixture
  const mean = [0, 0]; mix9.pi.forEach((p, k) => { mean[0] += p * mix9.mu[k][0]; mean[1] += p * mix9.mu[k][1]; });
  const x1 = sampleI(mix9, 1, 500, 5), spread = Math.sqrt(x1.reduce((a, x) => a + (x[0] - mean[0]) ** 2 + (x[1] - mean[1]) ** 2, 0) / x1.length);
  facts.mean_dist = Math.hypot(mean[0], mean[1]); facts.pass1_spread = spread;
  ok('one pass puts every draw within 0.1 m/s of the mean of the mixture', spread < 0.1, spread);
  ok('...and the mean of the mixture lies on the neutral button (within 0.05 m/s of 0), the most frequent one', facts.mean_dist < 0.05, facts.mean_dist);
  ok('one pass reaches one code; three reach all nine', facts.modes_n1 === 1 && facts.modes_n3 === 9, [facts.modes_n1, facts.modes_n3]);
  ok('the distance to the press rates falls: n = 1 > 3 > 4 > 8 > 16', facts.tv_n1 > facts.tv_n3 && facts.tv_n3 > facts.tv_n4 && facts.tv_n4 > facts.tv_n8 && facts.tv_n8 > facts.tv_n16, NP.map(n => facts['tv_n' + n]));
  // sampling-noise floor: draw 2000 samples directly from the mixture (ancestral sampling) and measure the same distance
  const rng = CY.rng(8), cum = []; { let a = 0; for (const p of mix9.pi) { a += p; cum.push(a); } }
  const xs = []; for (let j = 0; j < 2000; j++) { const u = rng(); let k = cum.findIndex(c => u <= c); if (k < 0) k = 8; xs.push([mix9.mu[k][0] + mix9.sd[k] * CY.randn(rng), mix9.mu[k][1] + mix9.sd[k] * CY.randn(rng)]); }
  facts.tv_direct = modeStatsI(mix9, xs).tv; ok('64 passes are as good as drawing the mixture directly (within 0.03)', Math.abs(modeStatsI(mix9, sampleI(mix9, 64, 2000, 5)).tv - facts.tv_direct) < 0.03, [modeStatsI(mix9, sampleI(mix9, 64, 2000, 5)).tv, facts.tv_direct]);
  facts.tv_n64 = modeStatsI(mix9, sampleI(mix9, 64, 2000, 5)).tv;
}
{ // given the code: one component, the Euler recursion is linear and has a closed form: x_n - mu = (x_0 - mu) prod_i (1 + (s_{i+1} - s_i) s_i / (v + s_i^2)), v = sd^2
  const c = 0, one = { pi: [1], mu: [mix9.mu[c]], sd: [mix9.sd[c]] };
  for (const n of [1, 2, 4, 8]) {
    const sg = sigmasI(n); let prod = 1; for (let i = 0; i < n; i++) prod *= 1 + (sg[i + 1] - sg[i]) * sg[i] / (one.sd[0] ** 2 + sg[i] ** 2);
    const xs = sampleI(one, n, 4000, 5), mx = xs.reduce((a, x) => a + x[0] / xs.length, 0), my = xs.reduce((a, x) => a + x[1] / xs.length, 0);
    const sdx = Math.sqrt(xs.reduce((a, x) => a + ((x[0] - mx) ** 2 + (x[1] - my) ** 2) / 2 / xs.length, 0));
    const meanClosed = [one.mu[0][0] + (0 - one.mu[0][0]) * prod, one.mu[0][1] + (0 - one.mu[0][1]) * prod], sdClosed = SMAX * Math.abs(prod);
    ok('single-code sampler vs its closed form (n = ' + n + '): mean and spread', Math.hypot(mx - meanClosed[0], my - meanClosed[1]) < 0.01 && Math.abs(sdx / sdClosed - 1) < 0.06, [mx, my, meanClosed, sdx, sdClosed]);
    if (n === 1) { facts.cond_err_n1 = Math.hypot(mx - one.mu[0][0], my - one.mu[0][1]); facts.cond_spread_n1 = sdx; facts.cond_sd = one.sd[0]; }
  }
  ok('given the button one pass lands within 0.01 m/s of the code\'s push', facts.cond_err_n1 < 0.01, facts.cond_err_n1);
}
{ // more passes do not make the draws steerable: the controllability of the unconditioned sampler at 16 passes
  const xs1 = sampleI(mix9, 16, 6000, 31), xs2 = sampleI(mix9, 16, 6000, 32), ys1 = sampleI(mix9, 16, 6000, 33), ys2 = sampleI(mix9, 16, 6000, 34);
  let bt = 0, wn = 0; for (let i = 0; i < 6000; i++) { bt += Math.hypot(xs1[i][0] - xs2[i][0], xs1[i][1] - xs2[i][1]) / 6000; wn += Math.hypot(ys1[i][0] - ys2[i][0], ys1[i][1] - ys2[i][1]) / 6000; }
  facts.ctl_pass16 = bt / wn; ok('16 passes, no button: still not steerable (ratio 1 +- 0.05)', Math.abs(facts.ctl_pass16 - 1) < 0.05, facts.ctl_pass16);
}

/* ── 8. latency and attention-pair arithmetic ── */
facts.fps = 24; facts.budget_ms = 1000 / 24; facts.frame_ms_30 = 1000 / 30; facts.maxpass_10 = Math.floor(1000 / 24 / 10); facts.maxpass_8 = Math.floor(1000 / 30 / 8);
facts.pass_ms_for4 = 1000 / 24 / 4; facts.lat_n4_10 = 40; facts.fps_n5_10 = 1000 / 50; facts.fps_n4_10 = 1000 / 40;
{ // attention pairs to draw ONE new frame of T tokens, with a window of n frames: recompute the window (bidirectional, all pairs) against a causal model with cached keys and values
  const pairsFull = (n, T) => { let c = 0; const N = n * T; for (let q = 0; q < N; q++) for (let k = 0; k < N; k++) c++; return c; };         // every token of the window against every token
  const pairsCached = (n, T) => { let c = 0; const N = n * T; for (let q = N - T; q < N; q++) for (let k = 0; k < N; k++) c++; return c; };    // only the T tokens of the new frame ask; the keys of the window are cached
  ok('mask enumeration: full window n = 4, T = 5 is (nT)^2', pairsFull(4, 5) === 400);
  ok('mask enumeration: cached new frame n = 4, T = 5 is T * nT', pairsCached(4, 5) === 100, pairsCached(4, 5));
  facts.pairs_full_court = (16 * 40) ** 2; facts.pairs_cached_court = 40 * 16 * 40; facts.pairs_ratio = 16;
  facts.pairs_full_real = (16 * 256) ** 2; facts.pairs_cached_real = 256 * 16 * 256;
  ok('pairs: cached = full / n', facts.pairs_full_court / facts.pairs_cached_court === 16 && facts.pairs_full_real / facts.pairs_cached_real === 16);
  facts.pairs_full_real_m = facts.pairs_full_real / 1e6; facts.pairs_cached_real_m = facts.pairs_cached_real / 1e6;
}
{ // a model that denoises a whole clip of T frames jointly can only react at clip boundaries: the wait for the next boundary
  facts.clip_T = 16; facts.clip_wait_max_s = 16 / 24; facts.clip_wait_mean_s = 16 / 24 / 2; facts.frame_wait_ms = 1000 / 24;
}
{ // per-pass bounds implied by the systems of the lesson (lesson 11 table): DERIVED, upper bounds on a pass
  facts.pass_ms_gamengen = 1000 / 20 / 4; facts.pass_ms_dreamer4 = 1000 / 21 / 4; facts.pass_ms_diamond = 1000 / 10 / 3;
  facts.frame_ms_gamengen1 = 1000 / 50;
}

/* ── 9. section 6: the smooth model, walls, sessions ── */
const NF = 48;
function smoothFitI(rows) {
  const rng = CY.rng(11), A = [], b = [];
  for (let h = 0; h < NF; h++) { const w = []; for (let j = 0; j < 6; j++) w.push(CY.randn(rng)); A.push(w); b.push(CY.randn(rng)); }
  const feat = x => { const f = x.concat([]); f.push(1); for (let h = 0; h < NF; h++) { let s = b[h]; for (let j = 0; j < 6; j++) s += A[h][j] * x[j]; f.push(Math.tanh(s)); } return f; };
  const inp = (s, a) => [s[0] / 4 - 1, s[1] / 2.5 - 1, s[2], s[3], a[0], a[1]], p = 7 + NF;
  const AA = Array.from({ length: p }, (_, i) => Array(p).fill(0).map((_, j) => (i === j ? 1e-3 : 0))), BB = Array.from({ length: p }, () => [0, 0, 0, 0]);
  for (const r of rows) { const f = feat(inp(r.z, r.a)), y = [0, 1, 2, 3].map(j => r.z2[j] - r.z[j]); for (let i = 0; i < p; i++) { for (let j = 0; j < p; j++) AA[i][j] += f[i] * f[j]; for (let q = 0; q < 4; q++) BB[i][q] += f[i] * y[q]; } }
  const Wt = solve(AA, BB, p);
  return (s, a) => { const f = feat(inp(s, a)), o = s.slice(); for (let q = 0; q < 4; q++) for (let j = 0; j < p; j++) o[q] += f[j] * Wt[j][q]; return o; };
}
function scoreSmoothI(pred, rows) {
  let ef = 0, ec = 0, nf = 0, nc = 0;
  for (const r of rows) { const p = pred(r.s, r.a), e = (p[2] - r.s2[2]) ** 2 + (p[3] - r.s2[3]) ** 2; if (r.contact) { ec += e; nc++; } else { ef += e; nf++; } }
  return { free: Math.sqrt(ef / nf), contact: Math.sqrt(ec / nc), nf, nc, ratio: Math.sqrt(ec / nc) / Math.sqrt(ef / nf) };
}
const VW3 = videoI(3, NV, true), VW4 = videoI(4, NV, true);
facts.wall_share_pct = 100 * VW3.filter(r => r.contact).length / VW3.length;
const predC = smoothFitI(V1), predW = smoothFitI(VW3), scC = scoreSmoothI(predC, VW4), scW = scoreSmoothI(predW, VW4);
facts.sm_free_clean = scC.free; facts.sm_wall_clean = scC.contact; facts.sm_ratio_clean = scC.ratio;
facts.sm_free_walls = scW.free; facts.sm_wall_walls = scW.contact; facts.sm_ratio_walls = scW.ratio; facts.sm_free_worse = scW.free / scC.free; facts.n_wall_test = scW.nc;
ok('smooth model, clean clips: error at the wall steps is at least 50 times its free-flight error', scC.ratio > 50, scC.ratio);
ok('smooth model, video with walls: error at the wall steps is 8 to 30 times the error elsewhere', scW.ratio > 8 && scW.ratio < 30, scW.ratio);
ok('smooth model, video with walls: the free steps get worse than on clean clips (at least 4 times)', facts.sm_free_worse > 4, facts.sm_free_worse);
{
  const E = L14.smoothScore(L14.smoothFit(V1), L14.video(4, NV, { walls: true })); ok('engine smooth model == oracle smooth model (clean)', close(E.free, scC.free, 1e-6) && close(E.contact, scC.contact, 1e-6), [E, scC]);
  const E2 = L14.smoothScore(L14.smoothFit(L14.video(3, NV, { walls: true })), L14.video(4, NV, { walls: true })); ok('engine smooth model == oracle smooth model (walls)', close(E2.free, scW.free, 1e-6) && close(E2.contact, scW.contact, 1e-6), [E2, scW]);
}
{ // robustness: a 32 x 32 tanh network (Adam) on four times the video with walls
  const V4x = videoI(5, 4 * NV, true), inp = (s, a) => [s[0] / 4 - 1, s[1] / 2.5 - 1, s[2], s[3], a[0], a[1]];
  const net = new CY.MLP([6, 32, 32, 4], 5); net.fit(V4x.map(r => inp(r.z, r.a)), V4x.map(r => r.z2.map((v, j) => v - r.z[j])), { epochs: 25, batch: 32, lr: 0.01, seed: 3 });
  const sc = scoreSmoothI((s, a) => { const o = net.predict(inp(s, a)); return [s[0] + o[0], s[1] + o[1], s[2] + o[2], s[3] + o[3]]; }, VW4);
  facts.mlp_free = sc.free; facts.mlp_wall = sc.contact; facts.mlp_ratio = sc.ratio;
  ok('a 32 x 32 network on 4x the video: wall steps still at least 8 times worse', sc.ratio > 8, sc.ratio);
}
function sessionI(pred, seed, T) {
  const rng = CY.rng(seed); let s = [1 + 6 * rng(), 1 + 3 * rng(), 0.6 * CY.randn(rng), 0.6 * CY.randn(rng)], q = s.slice(), tc = -1; const err = [];
  for (let t = 0; t < T; t++) {
    const u = rng(); let k = -1; if (u >= P0) k = Math.min(7, Math.floor((u - P0) / (1 - P0) * 8));
    const a = sym(k), s2 = stepI(s, k < 0 ? null : a);
    if (tc < 0 && (Math.abs(s2[0] - (s[0] + GG * (s[2] + a[0]))) > 1e-9 || Math.abs(s2[1] - (s[1] + GG * (s[3] + a[1]))) > 1e-9)) tc = t;
    q = pred(q, a); s = s2; err.push(Math.hypot(q[0] - s[0], q[1] - s[1]));
  }
  return { err, tc };
}
const med = a => { const b = a.slice().sort((x, y) => x - y); return b.length ? b[Math.floor(b.length / 2)] : NaN; };
{
  const S = []; for (let i = 0; i < 400; i++) S.push(sessionI(predC, 9 + i, 40));
  const free = S.filter(x => x.tc < 0), hit = S.filter(x => x.tc >= 0);
  facts.ses_share_wall = 100 * hit.length / S.length; facts.ses_n_free = free.length; facts.ses_n_hit = hit.length;
  facts.ses_free10 = med(free.map(x => x.err[9])); facts.ses_free20 = med(free.map(x => x.err[19])); facts.ses_free40 = med(free.map(x => x.err[39]));
  facts.ses_hit0 = med(hit.filter(x => x.tc + 4 < 40).map(x => x.err[x.tc])); facts.ses_hit4 = med(hit.filter(x => x.tc + 4 < 40).map(x => x.err[x.tc + 4]));
  facts.ses_hit_vs_free = facts.ses_hit4 / facts.ses_free20;
  ok('sessions: a wall step costs more position error than 20 free steps (within 1 step: hit0 > free20)', facts.ses_hit0 > facts.ses_free20, [facts.ses_hit0, facts.ses_free20]);
  ok('sessions: five steps after a wall hit the position error is 3 times what 20 free steps give', facts.ses_hit4 > 3 * facts.ses_free20, [facts.ses_hit4, facts.ses_free20]);
  ok('sessions: position error without walls grows slowly and steadily (10 < 20 < 40 steps)', facts.ses_free10 < facts.ses_free20 && facts.ses_free20 < facts.ses_free40);
  const E = L14.sessionStats(L14.smoothFit(V1), 400, 40, 9); ok('engine sessions == oracle sessions', close(E.free20, facts.ses_free20, 1e-6) && close(E.hit4, facts.ses_hit4, 1e-6) && close(E.share * 100, facts.ses_share_wall, 1e-9), [E, facts.ses_free20]);
}

/* ── 10. the page's own widget must print the same numbers ── */
const PAGE = path.join(DIR, '14_latent_actions_interactive.html'), HAVE_PAGE = fs.existsSync(PAGE);
ok('the lesson page exists', HAVE_PAGE);
const page = HAVE_PAGE ? loadPage(PAGE, { dpr: 1 }) : { problems: [], set() {}, num() { return NaN; }, text() { return ''; }, click() {} };
ok('page loads cleanly', page.problems.length === 0, page.problems.join(' | '));
function setAll(lab, K, pass, ms, pick, view) { page.set('w14-lab', lab); page.set('w14-k', K); page.set('w14-pass', pass); page.set('w14-ms', ms); page.set('w14-pick', pick); page.set('w14-view', view); }
const nums = id => (page.text(id).replace(/−/g, '-').match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
if (HAVE_PAGE) {
  setAll(20, 9, 4, 10, 'random', 'latency');
  ok('widget: purity (K = 9)', close(nums('w14-pur')[0], facts.pur_K9, 0.051), [nums('w14-pur'), facts.pur_K9]);
  ok('widget: code entropy (K = 9)', close(nums('w14-pur')[1], facts.Hc_K9, 0.0051), [nums('w14-pur'), facts.Hc_K9]);
  ok('widget: decoder error and floor (K = 9)', close(nums('w14-dec')[0], facts.dist_K9, 0.00051) && close(nums('w14-dec')[1], facts.floor_comb, 0.00051), [nums('w14-dec'), facts.dist_K9, facts.floor_comb]);
  for (const n of [0, 9, 20, 60]) {
    page.set('w14-lab', n);
    const s = curve.R[n]; ok('widget: named accuracy, ' + n + ' random labels', close(nums('w14-acc')[0], 100 * s.acc, 0.051), [nums('w14-acc'), 100 * s.acc]);
    ok('widget: mapped-action error, ' + n + ' labels', close(nums('w14-map')[0], s.rmse, 0.00051), [nums('w14-map'), s.rmse]);
    ok('widget: buttons right, ' + n + ' labels', nums('w14-btn')[0] === s.right, [nums('w14-btn'), s.right]);
    const e = idmWidget[n]; ok('widget: inverse dynamics error, ' + n + ' labels', close(nums('w14-idm')[0], e.rmse, 0.00051), [nums('w14-idm'), e.rmse]);
  }
  page.set('w14-lab', 9); page.set('w14-pick', 'guided');
  ok('widget: nine guided labels give the guided accuracy', close(nums('w14-acc')[0], facts.guided_acc_n9, 0.051) && nums('w14-btn')[0] === facts.guided_right_n9, [nums('w14-acc'), nums('w14-btn')]);
  page.set('w14-pick', 'random');
  ok('widget: controllability with the codes (K = 9)', close(nums('w14-ct')[0], facts.ctl_ratio_K9, 0.2), [nums('w14-ct'), facts.ctl_ratio_K9]);
  ok('widget: controllability without the codes', close(nums('w14-cf')[0], 1, 0.06), nums('w14-cf'));
  for (const K of [4, 8, 12, 16]) { page.set('w14-k', K); if (facts['pur_K' + K] !== undefined) { ok('widget: purity at K = ' + K, close(nums('w14-pur')[0], facts['pur_K' + K], 0.051), [nums('w14-pur'), facts['pur_K' + K]]); ok('widget: decoder error at K = ' + K, close(nums('w14-dec')[0], facts['dist_K' + K], 0.00051), [nums('w14-dec'), facts['dist_K' + K]]); } }
  page.set('w14-k', 9);
  for (const n of [1, 2, 3, 4, 8, 16]) { page.set('w14-pass', n); ok('widget: modes reached, ' + n + ' passes', nums('w14-md')[0] === facts['modes_n' + n], [nums('w14-md'), facts['modes_n' + n]]); ok('widget: distance to the press rates, ' + n + ' passes', close(nums('w14-tv')[0], facts['tv_n' + n], 0.0051), [nums('w14-tv'), facts['tv_n' + n]]); }
  page.set('w14-pass', 4); page.set('w14-ms', 10); ok('widget: latency of 4 passes at 10 ms', nums('w14-lat')[0] === 40 && nums('w14-lat')[1] === 25 && nums('w14-fit')[0] === 4, [nums('w14-lat'), nums('w14-fit')]);
  page.set('w14-pass', 5); ok('widget: latency of 5 passes at 10 ms misses 24 fps', nums('w14-lat')[0] === 50 && nums('w14-lat')[1] === 20, nums('w14-lat'));
  page.set('w14-ms', 8); page.set('w14-pass', 5); ok('widget: 5 passes at 8 ms: 40 ms, 25 fps', nums('w14-lat')[0] === 40, nums('w14-lat'));
  page.set('w14-view', 'walls');
  ok('widget: smooth model, clean clips and walls (free steps)', close(nums('w14-wf')[0], facts.sm_free_clean, 0.00051) && close(nums('w14-wf')[1], facts.sm_free_walls, 0.00051), [nums('w14-wf'), facts.sm_free_clean, facts.sm_free_walls]);
  ok('widget: smooth model at the wall steps, clean clips then with bounces', close(nums('w14-wc')[0], facts.sm_wall_clean, 0.0051) && close(nums('w14-wc')[1], facts.sm_wall_walls, 0.0051) && close(nums('w14-wc')[2], facts.sm_ratio_clean, 0.51) && close(nums('w14-wc')[3], facts.sm_ratio_walls, 0.051), [nums('w14-wc'), facts.sm_wall_clean, facts.sm_wall_walls, facts.sm_ratio_clean, facts.sm_ratio_walls]);
}
ok('widget ran without errors', page.problems.length === 0, page.problems.join(' | '));
console.error(fails ? `${fails} check(s) FAILED` : 'all checks passed');
console.log(JSON.stringify({ facts }));
process.exit(fails ? 1 : 0);
