#!/usr/bin/env node
'use strict';
/* Oracle for robot_model_training lesson 09 (watching: learning from video without actions).
 * Everything the lesson quotes is recomputed here with code written separately from idm_lab.js: its own rollout loop and plant, its own kernel regressor (frames sorted by x, a binary
 * search instead of grid cells), its own gain fit, labels written as plain differences, its own ridge solver, its own press task.  Only the world's primitives (arm, expert's path,
 * collision, horizon) come from bench.js.  Then the page's widget is driven into the states the prose describes and must print what the independent computation gives.
 * Last stdout line: {"facts": {...}}. */
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '../../../all_lessons');
const dir = fs.existsSync(path.join(root, 'robot_model_training_new')) ? 'robot_model_training_new' : 'robot_model_training';
const BN = require(path.join(root, dir, 'bench.js'));
const { loadPage } = require('../dom_probe.js');

let bad = 0;
const fail = (m) => { bad++; console.error('FAIL ' + m); };
const check = (c, m) => { if (!c) fail(m); };
const F = {};
const r3 = (x) => +x.toFixed(3);

/* ───── the world, written out again ───── */
const DT = 0.05, JIT = 0.01, H = 0.015, SEED = 5, NEVAL = 200, GUST = 0.05, WOB = 0.10, STEADY = 0.05;
const W5 = BN.slalom.world(5), BODY = W5.body, T5 = BN.slalom.horizon(W5), SW = BN.slalom.W;
function carrot(w, q) {                                // the expert's wanted cup velocity: aim 6 cm ahead on the path, 15 cm/s, slow down at the end
  const p = BN.arm.fk(q, BODY), xe = BN.slalom.xEnd(w), xa = Math.min(xe, p[0] + SW.look), ty = BN.slalom.yref(w, xa);
  const dx = xa - p[0], dy = ty - p[1], d = Math.hypot(dx, dy) || 1e-9, sp = SW.speed * Math.min(1, Math.max(0, (xe - p[0]) / 0.06 + 0.1));
  return [dx / d * sp, dy / d * sp];
}
function joint(q, v) { return BN.arm.dls(BN.arm.jac(q, BODY), v, 1e-4); }
function plant(q, u, gust, rng) {                      // q += dt (clip(u) + gust N(0,1)), joint 1 then joint 2
  for (let a = 0; a < 2; a++) q[a] += DT * (Math.max(-1.5, Math.min(1.5, u[a])) + gust * BN.randn(rng));
}
function run(w, act, rng, gust, T) {                   // one rollout: positions Z (one more than commands), commands V
  const q = BN.slalom.startQ(w, JIT * BN.randn(rng)).slice(), Z = [], V = [], xe = BN.slalom.xEnd(w);
  let coll = false, done = false;
  for (let t = 0; t < T; t++) {
    const p = BN.arm.fk(q, BODY); Z.push(p);
    if (BN.slalom.collide(w, p)) { coll = true; break; }
    if (p[0] > xe - 0.02) { done = true; break; }
    const v = act(q, p); V.push(v); plant(q, joint(q, v), gust, rng);
  }
  return { Z, V, coll, done };
}
const record = (count, seed, gust) => { const rng = BN.rng(seed), out = []; for (let k = 0; k < count; k++) out.push(run(W5, (q) => carrot(W5, q), rng, gust, T5)); return out; };
function wilson(k, n) { const z = 1.96, p = k / n, d = 1 + z * z / n, c = (p + z * z / (2 * n)) / d, h = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d; return [Math.max(0, c - h), Math.min(1, c + h)]; }

/* the policy: kernel regression over frames [position, velocity], frames sorted by x */
function kernel(frames) {
  const ord = frames.map((f, i) => i).sort((a, b) => frames[a][0][0] - frames[b][0][0] || a - b);
  const X = new Float64Array(ord.length), Yy = new Float64Array(ord.length), A = new Float64Array(ord.length), B = new Float64Array(ord.length);
  ord.forEach((i, k) => { X[k] = frames[i][0][0]; Yy[k] = frames[i][0][1]; A[k] = frames[i][1][0]; B[k] = frames[i][1][1]; });
  const n = X.length;
  return (p) => {
    let lo = 0, hi = n; const x0 = p[0] - 3 * H; while (lo < hi) { const m = (lo + hi) >> 1; if (X[m] < x0) lo = m + 1; else hi = m; }
    let sw = 0, a = 0, b = 0;
    for (let k = lo; k < n && X[k] <= p[0] + 3 * H; k++) {
      const e = ((X[k] - p[0]) / H) ** 2 + ((Yy[k] - p[1]) / H) ** 2;
      if (e <= 9) { const w = Math.exp(-0.5 * e); sw += w; a += w * A[k]; b += w * B[k]; }
    }
    if (sw >= 1e-12) return [a / sw, b / sw];
    let best = Infinity, bk = 0; for (let k = 0; k < n; k++) { const e = ((X[k] - p[0]) / H) ** 2 + ((Yy[k] - p[1]) / H) ** 2; if (e < best) { best = e; bk = k; } }
    return [A[bk], B[bk]];
  };
}
function evaluate(pol, N, seed) {
  const rng = BN.rng(seed); let ok = 0, co = 0;
  for (let k = 0; k < N; k++) { const r = run(W5, (q, p) => pol(p), rng, GUST, T5); if (r.done) ok++; if (r.coll) co++; }
  const ci = wilson(ok, N); return { succ: ok / N, coll: co / N, lo: ci[0], hi: ci[1] };
}

/* ───── the model: gain, labels, error ───── */
function gainFit(runs) {
  let sxy = 0, sxx = 0;
  for (const r of runs) for (let t = 0; t < r.V.length; t++) for (let a = 0; a < 2; a++) { sxy += (r.Z[t + 1][a] - r.Z[t][a]) / DT * r.V[t][a]; sxx += r.V[t][a] ** 2; }
  return sxy / sxx;
}
function solveRidge(Amat, b, m) {                      // Cholesky solve of the symmetric positive definite system A c = b
  const Lm = Array.from({ length: m }, () => new Array(m).fill(0));
  for (let i = 0; i < m; i++) for (let j = 0; j <= i; j++) { let s = Amat[i][j]; for (let k = 0; k < j; k++) s -= Lm[i][k] * Lm[j][k]; Lm[i][j] = i === j ? Math.sqrt(s) : s / Lm[j][j]; }
  const y = new Array(m), c = new Array(m);
  for (let i = 0; i < m; i++) { let s = b[i]; for (let k = 0; k < i; k++) s -= Lm[i][k] * y[k]; y[i] = s / Lm[i][i]; }
  for (let i = m - 1; i >= 0; i--) { let s = y[i]; for (let k = i + 1; k < m; k++) s -= Lm[k][i] * c[k]; c[i] = s / Lm[i][i]; }
  return c;
}
function windowTaps(runs, B, Fw) {                     // ridge fit of v(t) on z(t+j) - z(t), j = -B..F without 0, shared by both axes
  const js = []; for (let j = -B; j <= Fw; j++) if (j !== 0) js.push(j);
  const m = js.length, Amat = Array.from({ length: m }, () => new Array(m).fill(0)), b = new Array(m).fill(0);
  for (const r of runs) for (let t = B; t + Fw < r.Z.length && t < r.V.length; t++) for (let a = 0; a < 2; a++) {
    const x = js.map((j) => r.Z[t + j][a] - r.Z[t][a]);
    for (let i = 0; i < m; i++) { b[i] += x[i] * r.V[t][a]; for (let k = 0; k < m; k++) Amat[i][k] += x[i] * x[k]; }
  }
  let tr = 0; for (let i = 0; i < m; i++) tr += Amat[i][i];
  for (let i = 0; i < m; i++) Amat[i][i] += 1e-6 * tr / m;
  return { js, c: solveRidge(Amat, b, m) };
}
/* labels of a run by kind: returns [{t, pos, v}] for every frame the kind can label */
function labels(kind, g, taps, r) {
  const out = [], s = 1 / (g * DT), n = r.Z.length, d = (t, j, a) => r.Z[t + j][a] - r.Z[t][a];
  if (kind === 'fwd') for (let t = 0; t + 1 < n; t++) out.push([r.Z[t], [d(t, 1, 0) * s, d(t, 1, 1) * s]]);
  else if (kind === 'past') for (let t = 1; t < n; t++) out.push([r.Z[t], [-d(t, -1, 0) * s, -d(t, -1, 1) * s]]);
  else if (kind === 'cen') for (let t = 1; t + 1 < n; t++) out.push([r.Z[t], [(d(t, 1, 0) - d(t, -1, 0)) * s / 2, (d(t, 1, 1) - d(t, -1, 1)) * s / 2]]);
  else if (kind === 'win') { const B = 6; for (let t = B; t + B < n; t++) { const v = [0, 0]; taps.js.forEach((j, i) => { v[0] += taps.c[i] * d(t, j, 0); v[1] += taps.c[i] * d(t, j, 1); }); out.push([r.Z[t], v]); } }
  return out;
}
function frameErr(kind, g, taps, runs) {               // per-frame error against the commands, relative to their size (frames that carry a command)
  let se = 0, ss = 0;
  for (const r of runs) { const ls = labels(kind, g, taps, r), t0 = kind === 'fwd' ? 0 : kind === 'win' ? 6 : 1; ls.forEach((l, i) => { const t = t0 + i; if (t < r.V.length) { se += (l[1][0] - r.V[t][0]) ** 2 + (l[1][1] - r.V[t][1]) ** 2; ss += r.V[t][0] ** 2 + r.V[t][1] ** 2; } }); }
  return Math.sqrt(se / ss);
}
const framesOf = (runs) => { const o = []; for (const r of runs) for (let t = 0; t < r.V.length; t++) o.push([r.Z[t], r.V[t]]); return o; };
function training(src, lab, foot) {                    // the frames the policy is trained on
  let fr = framesOf(lab);
  if (src === 'true') return fr.concat(framesOf(foot));
  if (src === 'self') { const own = kernel(fr); for (const r of foot) for (let t = 0; t < r.V.length; t++) fr.push([r.Z[t], own(r.Z[t])]); return fr; }
  const g = gainFit(lab), taps = src === 'win' ? windowTaps(lab, 6, 6) : null;
  for (const r of foot) fr = fr.concat(labels(src, g, taps, r));
  return fr;
}
const clip = (arr, n) => arr.slice(0, n);

/* ───── the experiment ───── */
const LAB = record(2, 1, GUST), FOOT = record(16, 2, WOB), FOOT_S = record(16, 2, STEADY), VAL = record(10, 3, GUST);
const g2 = gainFit(LAB), win2 = windowTaps(LAB, 6, 6);
F.gain_hat = r3(g2);
{ let steps = 0; const rr = record(20, 11, GUST); rr.forEach((r) => { steps += r.V.length; }); F.demo_steps = r3(steps / 20); F.demo_s = r3(steps / 20 * DT); }
F.lab_s = r3(LAB.reduce((a, r) => a + r.V.length, 0) * DT); F.lab_frames = LAB.reduce((a, r) => a + r.V.length, 0);
F.foot_frames = FOOT.reduce((a, r) => a + r.V.length, 0); F.foot_min = r3(F.foot_frames * DT / 60);
const VGRID = [0, 1, 2, 3, 5, 8, 12, 16];
const cache = {};
function success(src, V, labRuns, footRuns, tag) {
  const key = [src, V, tag].join('|'); if (cache[key]) return cache[key];
  const ev = evaluate(kernel(training(src, labRuns, clip(footRuns, V))), NEVAL, SEED); return (cache[key] = ev);
}
const base2 = success('true', 0, LAB, FOOT, 'L2w');
F.clone2_succ = r3(base2.succ * 100); F.clone2_lo = r3(base2.lo * 100); F.clone2_hi = r3(base2.hi * 100);
{ const rng = BN.rng(SEED); let ok = 0; for (let k = 0; k < NEVAL; k++) if (run(W5, (q) => carrot(W5, q), rng, GUST, T5).done) ok++; F.expert_succ = r3(ok / NEVAL * 100); }
// the table at 16 clips of wobbly footage
const SRC = ['fwd', 'past', 'cen', 'win', 'self', 'true'];
const tab = {};
for (const s of SRC) {
  const ev = success(s, 16, LAB, FOOT, 'L2w'); tab[s] = ev;
  F['succ_' + s] = r3(ev.succ * 100); F['lo_' + s] = r3(ev.lo * 100); F['hi_' + s] = r3(ev.hi * 100);
  if (s !== 'self' && s !== 'true') F['err_' + s] = r3(frameErr(s, g2, win2, FOOT) * 100);
}
{ // per-frame error of the policy's own labels
  const own = kernel(framesOf(LAB)); let se = 0, ss = 0; for (const r of FOOT) for (let t = 0; t < r.V.length; t++) { const a = own(r.Z[t]); se += (a[0] - r.V[t][0]) ** 2 + (a[1] - r.V[t][1]) ** 2; ss += r.V[t][0] ** 2 + r.V[t][1] ** 2; } F.err_self = r3(Math.sqrt(se / ss) * 100);
  let far = 0, n = 0; const lf = framesOf(LAB); for (const r of FOOT) for (let t = 0; t < r.V.length; t++) { n++; let m = 1e9; for (const f of lf) { const dd = Math.hypot(f[0][0] - r.Z[t][0], f[0][1] - r.Z[t][1]); if (dd < m) m = dd; } if (m > 3 * H) far++; } F.self_far = r3(far / n * 100);
}
F.err_fwd_lab = r3(frameErr('fwd', g2, win2, VAL) * 100); F.err_win_lab = r3(frameErr('win', g2, win2, VAL) * 100);
F.err_ratio_foot_lab = r3(F.err_fwd / F.err_fwd_lab);

/* the pull-back of a policy: how hard its sideways command pushes the cup back toward the path, per metre of offset (1/s), averaged over ten stations along the course */
const STATIONS = [-0.4, -0.3, -0.2, -0.1, 0, 0.1, 0.2, 0.3, 0.4, 0.5], OFFS = [-0.02, -0.01, 0, 0.01, 0.02];
function pullBack(field) {
  let acc = 0;
  for (const x of STATIONS) { const yr = BN.slalom.yref(W5, x); let sxy = 0, sxx = 0; for (const d of OFFS) { sxy += d * field([x, yr + d], d)[1]; sxx += d * d; } acc += sxy / sxx; }
  return -acc / STATIONS.length;
}
const expertField = (p, d) => carrot(W5, BN.arm.ik(p, 1, BODY));
F.pull_expert = r3(pullBack(expertField));
for (const s of ['true', 'fwd', 'past', 'cen', 'win', 'self']) { const pol = kernel(training(s, LAB, FOOT)); F['pull_' + s] = r3(pullBack(pol)); }
F.pull_clone = r3(pullBack(kernel(framesOf(LAB))));

{ // why the step that arrived pulls the wrong way: the gust that put the cup at offset d is correlated with d; E[gust | d] = (s_v^2 dt / s_d^2) d
  let se = 0, n = 0, sd2 = 0, m = 0; for (const r of FOOT) { for (const l of labels('fwd', g2, null, r).slice(0, r.V.length)) { const i = n; } }
  for (const r of FOOT) for (let t = 0; t < r.V.length; t++) { const e = [(r.Z[t + 1][0] - r.Z[t][0]) / (g2 * DT) - r.V[t][0], (r.Z[t + 1][1] - r.Z[t][1]) / (g2 * DT) - r.V[t][1]]; se += e[0] ** 2 + e[1] ** 2; n++; const off = r.Z[t][1] - BN.slalom.yref(W5, r.Z[t][0]); sd2 += off * off; m++; }
  const sv = Math.sqrt(se / n / 2), sdl = Math.sqrt(sd2 / m); F.sv_cm = r3(sv * 100); F.sdelta_cm = r3(sdl * 100); F.c_pred = r3(sv * sv * DT / (sdl * sdl)); F.c_meas = r3(F.pull_true - F.pull_past); F.c_meas_cen = r3(F.pull_true - F.pull_cen); }
// the curve against the amount of footage
for (const V of VGRID) { F['curve_fwd_' + V] = r3(success('fwd', V, LAB, FOOT, 'L2w').succ * 100); F['curve_true_' + V] = r3(success('true', V, LAB, FOOT, 'L2w').succ * 100); }
{ const FOOT80 = record(80, 2, WOB); const a = evaluate(kernel(training('fwd', LAB, FOOT80)), NEVAL, SEED), b = evaluate(kernel(training('true', LAB, FOOT80)), NEVAL, SEED); F.fwd80 = r3(a.succ * 100); F.true80 = r3(b.succ * 100); F.foot80_min = r3(FOOT80.reduce((s, r) => s + r.V.length, 0) * DT / 60); }
// steady footage, and more of the robot's own labelled demonstrations
F.steady_fwd16 = r3(success('fwd', 16, LAB, FOOT_S, 'L2s').succ * 100); F.steady_true16 = r3(success('true', 16, LAB, FOOT_S, 'L2s').succ * 100);
for (const L of [8, 20, 200]) { const lab = record(L, 1, GUST); F['clone' + L + '_succ'] = r3(evaluate(kernel(framesOf(lab)), NEVAL, SEED).succ * 100); }
{ const lab8 = record(8, 1, GUST); F.fwd_L8 = r3(evaluate(kernel(training('fwd', lab8, FOOT)), NEVAL, SEED).succ * 100); F.gain_hat8 = r3(gainFit(lab8)); }
// labels taken from another frame (true commands, s frames later)
{ const shifted = (s) => { const o = []; for (const r of FOOT) for (let t = 0; t < r.V.length; t++) o.push([r.Z[t], r.V[Math.min(r.V.length - 1, Math.max(0, t + s))]]); return o; };
  for (const s of [1, 2, 3, -2, -3]) F['shift_' + (s > 0 ? 'p' : 'm') + Math.abs(s)] = r3(evaluate(kernel(framesOf(LAB).concat(shifted(s))), NEVAL, SEED).succ * 100);
  // the step that arrived with no gust in it: the command one frame earlier
  F.late1_true = r3(evaluate(kernel(framesOf(LAB).concat(shifted(-1))), NEVAL, SEED).succ * 100); }
// labels whose speed is wrong by a factor
for (const f of [0.7, 0.8, 0.9, 1.2]) { const fr = framesOf(LAB).concat(framesOf(FOOT).map((x) => [x[0], [x[1][0] * f, x[1][1] * f]])); F['scale_' + Math.round(f * 10)] = r3(evaluate(kernel(fr), NEVAL, SEED).succ * 100); }
// how well labelled demonstrations pin the gain and the frame alignment
{ const sd = {}, ns = {}; let shiftOk = 0; const trials = 60;
  for (const k of [1, 2, 4, 8, 16]) { const gs = []; for (let tr = 0; tr < trials; tr++) { const runs = record(k, 100 + tr, GUST); gs.push(gainFit(runs)); if (k === 1) { let best = null, bs = null; for (let s = -2; s <= 3; s++) { let sxy = 0, sxx = 0, syy = 0; for (const r of runs) for (let t = Math.max(0, -s); t + s + 1 < r.Z.length && t < r.V.length; t++) for (let a = 0; a < 2; a++) { const y = (r.Z[t + s + 1][a] - r.Z[t + s][a]) / DT, v = r.V[t][a]; sxy += y * v; sxx += v * v; syy += y * y; } const res = syy - sxy * sxy / sxx; if (best === null || res < best) { best = res; bs = s; } } if (bs === 0) shiftOk++; } }
    const m = gs.reduce((a, b) => a + b) / trials; sd[k] = Math.sqrt(gs.reduce((a, b) => a + (b - m) ** 2, 0) / trials) * 100; ns[k] = record(k, 100, GUST).reduce((a, r) => a + r.V.length, 0) * 2; F['gain_sd' + k] = r3(sd[k]); }
  const ls = BN.stats.logslope([1, 2, 4, 8, 16].map((k) => ns[k]), [1, 2, 4, 8, 16].map((k) => sd[k])); F.gain_slope = r3(ls.slope); F.shift_ok1 = shiftOk; F.shift_trials = trials; }
// latent actions without labels: any invertible map of the commands explains the footage equally well; labelled frames pin it down
{ const th = 0.65, M = [[1.6 * Math.cos(th), -0.7 * Math.sin(th)], [1.6 * Math.sin(th), 0.7 * Math.cos(th)]], det = M[0][0] * M[1][1] - M[0][1] * M[1][0], Mi = [[M[1][1] / det, -M[0][1] / det], [-M[1][0] / det, M[0][0] / det]];
  const pairs = []; for (const r of LAB) for (let t = 0; t < r.V.length; t++) { const m = [(r.Z[t + 1][0] - r.Z[t][0]) / DT, (r.Z[t + 1][1] - r.Z[t][1]) / DT]; pairs.push([[M[0][0] * m[0] + M[0][1] * m[1], M[1][0] * m[0] + M[1][1] * m[1]], r.V[t]]); }
  const rng = BN.rng(77); const out = {};
  for (const n of [2, 4, 8, 32]) { const errs = []; const T = 301; for (let tr = 0; tr < T; tr++) { const idx = []; while (idx.length < n) { const i = Math.floor(rng() * pairs.length); if (idx.indexOf(i) < 0) idx.push(i); }
      const S = [[0, 0], [0, 0]], R = [[0, 0], [0, 0]]; idx.forEach((i) => { const c = pairs[i][0], v = pairs[i][1]; for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) { S[a][b] += c[a] * c[b]; R[a][b] += v[a] * c[b]; } });
      for (let a = 0; a < 2; a++) S[a][a] += 1e-9; const dS = S[0][0] * S[1][1] - S[0][1] * S[1][0], Si = [[S[1][1] / dS, -S[0][1] / dS], [-S[1][0] / dS, S[0][0] / dS]];
      const Am = [[0, 0], [0, 0]]; for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) for (let k = 0; k < 2; k++) Am[a][b] += R[a][k] * Si[k][b];   // A c ~ v, so A M should be the identity
      const AM = [[0, 0], [0, 0]]; for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) for (let k = 0; k < 2; k++) AM[a][b] += Am[a][k] * M[k][b];
      errs.push(Math.sqrt(((AM[0][0] - 1) ** 2 + AM[0][1] ** 2 + AM[1][0] ** 2 + (AM[1][1] - 1) ** 2) / 2)); }
    errs.sort((a, b) => a - b); out[n] = errs[Math.floor(errs.length / 2)] * 100; F['latent_err' + n] = r3(out[n]); }
  F.latent_cond = r3(Math.hypot(...[M[0][0], M[0][1], M[1][0], M[1][1]]) * Math.hypot(Mi[0][0], Mi[0][1], Mi[1][0], Mi[1][1]) / 2); }
// predicting the next frame and decoding it is the same model: the kernel average commutes with the linear decoder
{ const fr = []; const g = g2; for (const r of FOOT) for (const l of labels('fwd', g, null, r)) fr.push([l[0], l[1]]);
  const pol = kernel(fr), disp = []; for (const r of FOOT) for (let t = 0; t + 1 < r.Z.length; t++) disp.push([r.Z[t], [r.Z[t + 1][0] - r.Z[t][0], r.Z[t + 1][1] - r.Z[t][1]]]);
  const video = kernel(disp); let gap = 0; for (let i = 0; i < disp.length; i += 7) { const p = disp[i][0], a = pol(p), b = video(p); gap = Math.max(gap, Math.abs(a[0] - b[0] / (g * DT)), Math.abs(a[1] - b[1] / (g * DT))); }
  F.decode_gap = +(gap * 100 < 1e-9 ? 0 : gap * 100).toFixed(9); F.decode_gap_raw = gap * 100; }

/* ───── pressing ───── */
const PX = 0.30, PY_W = 0.45, PY_0 = 0.60, PUSH = 0.15, NEED = 0.08, HOLD = 10, TP = 70, KX = 3;
function pressRun(act, seed, n, need) {
  const rng = BN.rng(seed), out = [];
  for (let k = 0; k < n; k++) {
    let q = BN.arm.ik([PX + JIT * BN.randn(rng), PY_0], 1, BODY); const Z = [], V = []; let run = 0, hit = false;
    for (let t = 0; t < TP; t++) {
      const p = BN.arm.fk(q, BODY); Z.push(p); const v = act(p); V.push(v);
      if (p[1] <= PY_W + 1e-9 && v[1] <= -need) { run++; if (run >= HOLD) hit = true; } else run = 0;
      plant(q, joint(q, v), GUST, rng);
      const pn = BN.arm.fk(q, BODY); if (pn[1] < PY_W) q = BN.arm.ik([pn[0], PY_W], 1, BODY);
    }
    Z.push(BN.arm.fk(q, BODY)); out.push({ Z, V, hit });
  }
  return out;
}
const demo = (push) => (p) => [KX * (PX - p[0]), p[1] > PY_W + 1e-9 ? -PUSH : -push];
const pfoot = (n, seed, push) => pressRun(demo(push === undefined ? PUSH : push), seed, n, NEED);
{ const d = pressRun(demo(PUSH), 4, 100, NEED); F.press_demo = d.filter((r) => r.hit).length;
  const PF = pfoot(16, 2); const gs = g2;
  const pressPolicy = (src, V) => { const fr = []; for (const r of PF.slice(0, V)) for (let t = 0; t < r.V.length; t++) fr.push([r.Z[t], src === 'true' ? r.V[t] : [(r.Z[t + 1][0] - r.Z[t][0]) / (gs * DT), (r.Z[t + 1][1] - r.Z[t][1]) / (gs * DT)]]); return kernel(fr); };
  for (const src of ['fwd', 'true']) for (const V of [1, 2, 5, 16]) { const pol = pressPolicy(src, V); F['press_' + src + '_' + V] = pressRun(pol, 5, NEVAL, NEED).filter((r) => r.hit).length / NEVAL * 100; }
  let sy = 0, ty = 0, n = 0; for (const r of PF) for (let t = 0; t < r.V.length; t++) if (r.Z[t][1] <= PY_W + 1e-9) { sy += (r.Z[t + 1][1] - r.Z[t][1]) / (gs * DT); ty += r.V[t][1]; n++; }
  F.push_inf = r3(Math.abs(sy / n * 100)); F.push_true = r3(Math.abs(ty / n * 100)); F.wall_frames = n; F.wall_share = r3(n / PF.reduce((a, r) => a + r.V.length, 0) * 100); F.press_need = NEED * 100; F.press_clip_s = TP * DT;
  const a = pfoot(5, 9, 0.15), b = pfoot(5, 9, 0.30); let md = 0; a.forEach((r, i) => r.Z.forEach((z, t) => { md = Math.max(md, Math.abs(z[0] - b[i].Z[t][0]), Math.abs(z[1] - b[i].Z[t][1])); })); F.press_diff_mm = r3(md * 1000);
  F.plate20_push30 = pressRun(demo(0.30), 4, 100, 0.20).filter((r) => r.hit).length; F.plate20_push15 = pressRun(demo(0.15), 4, 100, 0.20).filter((r) => r.hit).length; }


F.succ_gap_past = r3(F.succ_fwd - F.succ_past); F.gap_true = r3(F.succ_true - F.succ_fwd); F.gap_true80 = r3(F.true80 - F.fwd80); F.lift_fwd = r3(F.succ_fwd - F.clone2_succ);
F.ex_noise = r3(F.sv_cm / 10); F.ex_c = F.c_pred; F.ex_pull = r3(F.pull_true - F.c_pred);
F.cam_noise_cm = r3(Math.SQRT2 * 0.2 / DT);            // a camera that reports each position to 2 mm per axis: noise of a two-frame label, cm/s
F.mm_ratio_umi = r3(6.1 / 1);                          // UMI's tracking error over a 1 mm clearance

/* ───── checks of the claims in the prose ───── */
check(F.expert_succ >= 98, 'the expert completes the course under the gust (' + F.expert_succ + ')');
check(F.clone2_succ > 45 && F.clone2_succ < 65, 'two labelled demonstrations clone to about 55 % (' + F.clone2_succ + ')');
check(F.succ_fwd > F.clone2_succ + 20, 'footage labelled by the next step lifts success by more than 20 points (' + F.succ_fwd + ' vs ' + F.clone2_succ + ')');
check(F.succ_true - F.succ_fwd < 12 && F.succ_true > F.succ_fwd - 3, 'the next step comes within 12 points of the true commands (' + F.succ_fwd + ' vs ' + F.succ_true + ')');
check(F.succ_fwd - F.succ_past > 40, 'the step that arrived is more than 40 points worse than the step that follows (' + F.succ_past + ' vs ' + F.succ_fwd + ')');
check(Math.abs(F.err_past - F.err_fwd) < 10, 'the two steps have about the same per-frame error (' + F.err_past + ' vs ' + F.err_fwd + ')');
check(F.err_win < F.err_fwd / 2 && F.succ_fwd - F.succ_win > 25, 'the 13-frame filter has under half the per-frame error and loses more than 25 points (' + F.err_win + ', ' + F.succ_win + ')');
check(Math.abs(F.succ_self - F.clone2_succ) < 12 && F.self_far < 1, 'self-labelling gives back the clone (' + F.succ_self + ' vs ' + F.clone2_succ + '; far ' + F.self_far + ')');
check(F.succ_cen > F.succ_past + 20 && F.succ_cen < F.succ_fwd - 10, 'the centred difference sits between the two steps');
check(F.late1_true > 85 && F.shift_p1 < F.late1_true - 15 && F.shift_p2 < F.shift_p1 && F.shift_p3 <= F.shift_p2 && F.shift_p3 < 10, 'a label from a later frame ruins the policy, one from an earlier frame does not');
check(F.curve_fwd_2 > F.clone2_succ + 15 && Math.abs(F.curve_fwd_16 - F.curve_fwd_2) < 14, 'two clips already give most of the lift');
check(F.fwd80 > 75 && Math.abs(F.fwd80 - F.curve_fwd_16) < 10, 'eighty clips give no more than sixteen');
check(F.true80 - F.fwd80 > 0 && F.true80 - F.fwd80 < 15, 'the true-command policy stays a few points above the model-labelled one at eighty clips');
check(F.steady_true16 < F.succ_true - 10 && F.steady_fwd16 < F.succ_fwd - 8, 'steady footage lifts less than wobbly footage');
check(F.clone200_succ < 78 && F.clone200_succ < F.succ_fwd - 5, 'two hundred labelled demonstrations do not reach what sixteen clips of footage do (' + F.clone200_succ + ')');
check(F.gain_slope < -0.35 && F.gain_slope > -0.65, 'the gain error falls as the square root of the labelled frames (slope ' + F.gain_slope + ')');
check(F.shift_ok1 >= 0.95 * F.shift_trials, 'one labelled demonstration finds the right frame alignment (' + F.shift_ok1 + ' of ' + F.shift_trials + ')');
check(F.scale_7 < 5, 'labels 30 % too slow take the success to zero (' + F.scale_7 + ')');
check(Math.abs(F.c_pred - F.c_meas) < 0.3 * F.c_meas, 'the correlation of the arriving gust with the offset predicts the loss of pull-back (' + F.c_pred + ' vs ' + F.c_meas + ')');
check(F.pull_true > 0.05 && F.pull_fwd > 0.05 && ['past', 'cen', 'win', 'self', 'clone'].every((k) => F['pull_' + k] < 0), 'pull-back is positive for the true commands and the next step, negative for every other label source');
check(F.pull_expert > 0.8, 'the expert itself pulls back hard');
check(F.latent_err2 > 3 * F.latent_err32 && F.latent_err32 < 12, 'labelled frames pin the latent map down (' + F.latent_err2 + ', ' + F.latent_err32 + ')');
check(F.decode_gap < 1e-6, 'predict-then-decode equals label-then-regress (gap ' + F.decode_gap_raw + ')');
check(F.press_demo === 100, 'the demonstrator presses the plate every time');
check([1, 2, 5, 16].every((V) => F['press_fwd_' + V] === 0) && [1, 2, 5, 16].every((V) => F['press_true_' + V] === 100), 'the model-labelled policy never presses, the true-command policy always does');
check(F.push_inf < 0.5 && F.push_true > 14.9, 'on the table the model says no push and the demonstrator pushed at 15 cm/s');
check(F.press_diff_mm > 0 && F.press_diff_mm < 2, 'pushes of 15 and 30 cm/s leave footage that differs by under 2 mm (' + F.press_diff_mm + ')');
check(F.plate20_push30 === 100 && F.plate20_push15 === 0, 'a plate that needs 20 cm/s clicks for one demonstrator and not the other');

/* ───── the widget prints the same numbers ───── */
const html = path.join(root, dir, '09_watching_video.html');
if (fs.existsSync(html)) {
  const pg = loadPage(html);
  pg.problems.forEach((p) => fail('page problem: ' + p));
  const eqd = (id, want, digits, what) => { const got = pg.num(id); if (!(Math.abs(got - want) <= 0.5 * Math.pow(10, -digits) + 1e-9)) fail(`${what}: widget #${id} prints ${got}, independent computation gives ${want.toFixed(digits + 2)}`); };
  const set = (v, l, src, task, wob) => { pg.set('w09-task', task); pg.set('w09-wob', wob); pg.set('w09-src', src); pg.set('w09-l', l); pg.set('w09-v', v); pg.drain(); };
  const stateSlalom = (V, L, src, wob) => {
    const lab = L === 2 ? LAB : record(L, 1, GUST), foot = wob === WOB ? FOOT : FOOT_S, ev = evaluate(kernel(training(src, lab, clip(foot, V))), NEVAL, SEED), base = evaluate(kernel(framesOf(lab)), NEVAL, SEED), tru = evaluate(kernel(training('true', lab, clip(foot, V))), NEVAL, SEED);
    const g = gainFit(lab), taps = src === 'win' ? windowTaps(lab, 6, 6) : null; let se = 0, ss = 0;
    clip(foot, V).forEach((r) => { if (src === 'true') return; if (src === 'self') { const own = kernel(framesOf(lab)); for (let t = 0; t < r.V.length; t++) { const a = own(r.Z[t]); se += (a[0] - r.V[t][0]) ** 2 + (a[1] - r.V[t][1]) ** 2; ss += r.V[t][0] ** 2 + r.V[t][1] ** 2; } return; }
      const ls = labels(src, g, taps, r), t0 = src === 'fwd' ? 0 : src === 'win' ? 6 : 1; ls.forEach((l, i) => { const t = t0 + i; if (t < r.V.length) { se += (l[1][0] - r.V[t][0]) ** 2 + (l[1][1] - r.V[t][1]) ** 2; ss += r.V[t][0] ** 2 + r.V[t][1] ** 2; } }); });
    return { succ: ev.succ * 100, lo: ev.lo * 100, base: base.succ * 100, tru: tru.succ * 100, lerr: V && ss ? Math.sqrt(se / ss) * 100 : 0, gain: g, pull: pullBack(kernel(training(src, lab, clip(foot, V)))) };
  };
  const probe = (V, L, src, wob, tag) => { set(V === 0 ? 0 : VGRID.indexOf(V), L, src, 'slalom', wob); const r = stateSlalom(V, L, src, +wob); eqd('w09-succ', r.succ, 1, tag + ' success'); eqd('w09-base', r.base, 1, tag + ' clone-only'); eqd('w09-true', r.tru, 1, tag + ' true commands'); eqd('w09-lerr', r.lerr, 1, tag + ' label error'); eqd('w09-gain', r.gain, 3, tag + ' gain'); eqd('w09-pull', r.pull, 2, tag + ' pull-back'); const ci = pg.text('w09-ci').match(/[\d.]+/g).map(Number); if (Math.abs(ci[0] - r.lo) > 0.06) fail(tag + ' interval low: widget ' + ci[0] + ' vs ' + r.lo.toFixed(2)); };
  probe(16, 2, 'fwd', '0.1', 'default');
  probe(16, 2, 'past', '0.1', 'past step');
  probe(16, 2, 'win', '0.1', '13-frame filter');
  probe(16, 2, 'self', '0.1', 'self-labelling');
  probe(16, 2, 'true', '0.1', 'true commands');
  probe(2, 2, 'fwd', '0.1', '2 clips');
  probe(0, 2, 'fwd', '0.1', 'no footage');
  probe(16, 8, 'fwd', '0.1', '8 labelled demos');
  probe(16, 2, 'fwd', '0.05', 'steady footage');
  // the press task
  set(VGRID.indexOf(16), 2, 'fwd', 'press', '0.1');
  const pe = (src, V) => { const fr = []; for (const r of PF_ALL.slice(0, V)) for (let t = 0; t < r.V.length; t++) fr.push([r.Z[t], src === 'true' ? r.V[t] : [(r.Z[t + 1][0] - r.Z[t][0]) / (g2 * DT), (r.Z[t + 1][1] - r.Z[t][1]) / (g2 * DT)]]); return pressRun(kernel(fr), 5, NEVAL, NEED).filter((r) => r.hit).length / NEVAL * 100; };
  var PF_ALL = pfoot(16, 2);
  eqd('w09-succ', pe('fwd', 16), 1, 'press, model labels'); eqd('w09-true', pe('true', 16), 1, 'press, true commands'); eqd('w09-push', F.push_inf, 1, 'press, inferred push');
  pg.set('w09-src', 'true'); pg.drain(); eqd('w09-succ', pe('true', 16), 1, 'press, true commands selected');
}

console.log(JSON.stringify({ facts: F }));
process.exit(bad ? 1 : 0);
