#!/usr/bin/env node
'use strict';
/* Oracle for robot_model_training lesson 12 (a score as the only teacher: reinforcement learning).
 * Re-derives every number the lesson quotes with code written separately from rl_lab.js: its own attempt loop (the shared arm, collision test and expert come from
 * bench.js), its own table read (four explicit corners), its own clone (brute-force kernel regression, tabulated), its own mirrored-pair learner, evaluation and
 * statistics.  The estimator itself is checked against closed forms (a quadratic score, a step-function score whose derivative is zero almost everywhere, and the
 * cosine law 1/sqrt(1 + d/N)).  Then it drives the page's widget through the states the prose describes and checks that what it prints is what the independent
 * computation gives.  Last stdout line: {"facts": {...}}.
 * (Set ORC=<file> to cache the learner runs in a scratch file while iterating; the validator does not.) */
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

/* ───── the experiment, written out independently ───── */
const DT = 0.05, JIT = 0.01, GUST = 0.05, EDGE = 0.15, PRICE = 30, EVAL_N = 100, EVAL0 = 9000, CK = 60, MAXATT = 3000, NPAIR = 10, ETA = 2, RHO = 0.1, SEEDS = [11, 12, 13, 14, 15];
const LO = [-0.1, 1.1], HI = [1.7, 2.3];
const clip = (v, a) => Math.max(-a, Math.min(a, v));
const median = (a) => { const b = a.slice().sort((x, y) => x - y); return b[Math.floor(b.length / 2)]; };

function world(n, shift) { const w = BN.slalom.world(n, { shift }); return { w, n, T: BN.slalom.horizon(w), xs: BN.slalom.xStart(), xe: BN.slalom.xEnd(w), row: w.posts[0][1] }; }
function attempt(W, policy, seed, edge) {               // policy(q, u) writes the command; returns {done, prog}
  const rng = BN.rng(seed), q = BN.slalom.startQ(W.w, JIT * BN.randn(rng)).slice(), u = [0, 0], span = W.xe - 0.02 - W.xs;
  let xmax = -9;
  const prog = () => Math.max(0, Math.min(1, (xmax - W.xs) / span));
  for (let t = 0; t < W.T; t++) {
    const p = BN.arm.fk(q, W.w.body);
    if (BN.slalom.collide(W.w, p)) return { done: false, prog: prog() };
    if (edge && Math.abs(p[1] - W.row) > EDGE) return { done: false, prog: prog() };
    if (p[0] > W.xe - 0.02) return { done: true, prog: prog() };
    if (p[0] > xmax) xmax = p[0];
    policy(q, u);
    q[0] += DT * (clip(u[0], 1.5) + GUST * BN.randn(rng));
    q[1] += DT * (clip(u[1], 1.5) + GUST * BN.randn(rng));
  }
  return { done: false, prog: prog() };
}
const scoreOf = (r, reward) => (reward === 'sparse' ? (r.done ? 1 : 0) : r.prog + (r.done ? 1 : 0));
function spec(s) { const nx = Math.ceil((HI[0] - LO[0]) / s - 1e-9) + 1, ny = Math.ceil((HI[1] - LO[1]) / s - 1e-9) + 1; return { s, nx, ny, d: 2 * nx * ny }; }
function read(T, th, q, out) {                          // bilinear table: four explicit corners
  let fx = (q[0] - LO[0]) / T.s, fy = (q[1] - LO[1]) / T.s;
  fx = Math.min(Math.max(fx, 0), T.nx - 1.000001); fy = Math.min(Math.max(fy, 0), T.ny - 1.000001);
  const i = Math.floor(fx), j = Math.floor(fy), tx = fx - i, ty = fy - j; let u0 = 0, u1 = 0;
  for (let di = 0; di < 2; di++) for (let dj = 0; dj < 2; dj++) { const wgt = (di ? tx : 1 - tx) * (dj ? ty : 1 - ty), k = 2 * ((i + di) * T.ny + j + dj); u0 += wgt * th[k]; u1 += wgt * th[k + 1]; }
  out[0] = u0; out[1] = u1;
}
function nodesTouched(T, q, set) {                      // which table entries a state reads
  let fx = (q[0] - LO[0]) / T.s, fy = (q[1] - LO[1]) / T.s;
  fx = Math.min(Math.max(fx, 0), T.nx - 1.000001); fy = Math.min(Math.max(fy, 0), T.ny - 1.000001);
  const i = Math.floor(fx), j = Math.floor(fy), tx = fx - i, ty = fy - j;
  for (let di = 0; di < 2; di++) for (let dj = 0; dj < 2; dj++) if ((di ? tx : 1 - tx) * (dj ? ty : 1 - ty) > 0) set.add((i + di) * T.ny + j + dj);
}

/* the lesson-1 clone: 20 calm demonstrations, brute-force kernel regression (h = 0.02 rad, three bandwidths), copy of the nearest frame when none is near; then tabulated every 0.01 rad */
const priors = {};
function demoFrames(n) {
  const w = BN.slalom.world(n), T = BN.slalom.horizon(w), rng = BN.rng(1), X = [], Y = [];
  for (let k = 0; k < 20; k++) {
    const q = BN.slalom.startQ(w, JIT * BN.randn(rng)).slice();
    for (let t = 0; t < T; t++) {
      const p = BN.arm.fk(q, w.body); if (BN.slalom.collide(w, p) || p[0] > BN.slalom.xEnd(w) - 0.02) break;
      const u = BN.slalom.expertAct(w, q); X.push(q.slice()); Y.push(u); q[0] += DT * clip(u[0], 1.5); q[1] += DT * clip(u[1], 1.5);
    }
  }
  return { X, Y, w, T };
}
function kernelAt(D, qx, qy) {
  const H = 0.02; let sw = 0, a0 = 0, a1 = 0;
  for (let i = 0; i < D.X.length; i++) {
    const dx = D.X[i][0] - qx; if (dx > 3 * H || dx < -3 * H) continue;
    const dy = D.X[i][1] - qy, e = (dx / H) * (dx / H) + (dy / H) * (dy / H);
    if (e <= 9) { const wgt = Math.exp(-0.5 * e); sw += wgt; a0 += wgt * D.Y[i][0]; a1 += wgt * D.Y[i][1]; }
  }
  if (sw >= 1e-12) return [a0 / sw, a1 / sw];
  let best = Infinity, bi = 0;
  for (let i = 0; i < D.X.length; i++) { const e = ((D.X[i][0] - qx) / H) ** 2 + ((D.X[i][1] - qy) / H) ** 2; if (e < best) { best = e; bi = i; } }
  return [D.Y[bi][0], D.Y[bi][1]];
}
function prior(n) {
  if (priors[n]) return priors[n];
  const D = demoFrames(n), T = spec(0.01), th = new Float64Array(T.d);
  for (let i = 0; i < T.nx; i++) for (let j = 0; j < T.ny; j++) { const a = kernelAt(D, LO[0] + i * 0.01, LO[1] + j * 0.01), k = 2 * (i * T.ny + j); th[k] = a[0]; th[k + 1] = a[1]; }
  return (priors[n] = { T, th, D });
}
function policyOf(start, T, th, rho, pr) {              // returns policy(q, u); th is read at call time
  const v = [0, 0], p = [0, 0];
  return (q, u) => {
    read(T, th, q, v);
    if (start === 'scratch') { u[0] = v[0]; u[1] = v[1]; return; }
    if (start === 'residual') { v[0] = clip(v[0], rho); v[1] = clip(v[1], rho); }
    read(pr.T, pr.th, q, p); u[0] = p[0] + v[0]; u[1] = p[1] + v[1];
  };
}
function successRate(W, pol, seeds, edge) { let ok = 0; for (const s of seeds) if (attempt(W, pol, s, edge).done) ok++; return ok / seeds.length; }
const EVALSET = []; for (let k = 0; k < EVAL_N; k++) EVALSET.push(EVAL0 + k);
const BIGSET = []; for (let k = 0; k < 400; k++) BIGSET.push(7000 + k);

/* the learner: N = 10 mirrored pairs per update, both members of a pair meet the same gusts, theta += eta sigma (1/N) sum z_k eps_k with z_k = (R+ - R-)/(2 S) */
const cacheFile = process.env.ORC || null;                                    // a file path; development only
let disk = {}; try { if (cacheFile && fs.existsSync(cacheFile)) disk = JSON.parse(fs.readFileSync(cacheFile, 'utf8')); } catch (e) { disk = {}; }
const mem = {};
function learn(c) {                                     // c: n, shift, edge, s, start, reward, sigma, seed
  const key = JSON.stringify([c.n, c.shift, c.edge, c.s, c.start, c.reward, c.sigma, c.seed, !!c.keep, c.eta || ETA, c.N || NPAIR]);
  const eta = c.eta || ETA, np = c.N || NPAIR;
  if (mem[key]) return mem[key];
  if (disk[key] && !c.keep) return (mem[key] = disk[key]);
  const W = world(c.n, c.shift), T = spec(c.s), d = T.d, th = new Float64Array(d), pr = c.start === 'scratch' ? null : prior(c.n), rng = BN.rng(c.seed * 7919 + 13);
  const tp = new Float64Array(d), tm = new Float64Array(d), polP = policyOf(c.start, T, tp, RHO, pr), polM = policyOf(c.start, T, tm, RHO, pr), polMean = policyOf(c.start, T, th, RHO, pr);
  const curve = [[0, successRate(W, polMean, EVALSET, c.edge)]], winlog = [0]; let att = 0, wins = 0, first = -1;
  while (att < MAXATT) {
    const E = []; for (let k = 0; k < np; k++) { const e = new Float64Array(d); for (let i = 0; i < d; i++) e[i] = BN.randn(rng); E.push(e); }
    const R = [];
    for (let k = 0; k < np; k++) {
      const sd = 100000 + c.seed * 1000003 + att + 2 * k;
      for (let i = 0; i < d; i++) { tp[i] = th[i] + c.sigma * E[k][i]; tm[i] = th[i] - c.sigma * E[k][i]; }
      const rp = attempt(W, polP, sd, c.edge), rm = attempt(W, polM, sd, c.edge);
      R.push(scoreOf(rp, c.reward), scoreOf(rm, c.reward)); wins += (rp.done ? 1 : 0) + (rm.done ? 1 : 0);
    }
    att += 2 * np; if (first < 0 && wins > 0) first = att;
    let m = 0, v = 0; for (const x of R) m += x; m /= R.length; for (const x of R) v += (x - m) * (x - m);
    const S = Math.sqrt(v / R.length);
    if (S >= 1e-9) for (let k = 0; k < np; k++) { const z = (R[2 * k] - R[2 * k + 1]) / (2 * S), a = eta * c.sigma * z / np; for (let i = 0; i < d; i++) th[i] += a * E[k][i]; }
    if (att % CK === 0) { curve.push([att, successRate(W, polMean, EVALSET, c.edge)]); winlog.push(wins); }
  }
  let tmax = 0; for (let i = 0; i < d; i++) tmax = Math.max(tmax, Math.abs(th[i]));
  const out = { curve, winlog, wins, first, tmax, d, theta: c.keep ? Array.from(th) : null };
  mem[key] = out; if (!c.keep) disk[key] = { curve, winlog, wins, first, tmax, d, theta: null };
  return out;
}
const a90 = (curve) => { for (const p of curve) if (p[1] >= 0.9 - 1e-9) return p[0]; return Infinity; };
function group(base, sigmaVal) {                        // the five seeds of one setting
  const runs = SEEDS.map((sd) => learn(Object.assign({}, base, { sigma: sigmaVal === undefined ? base.sigma : sigmaVal, seed: sd })));
  const a = runs.map((r) => a90(r.curve));
  return { runs, a, med: median(a), min: Math.min(...a), max: Math.max(...a), never: a.filter((x) => x === Infinity).length,
    fin: runs.map((r) => r.curve[r.curve.length - 1][1] * 100), wins: runs.map((r) => r.wins), first: runs.map((r) => r.first) };
}
const B5 = { n: 5, shift: 0, edge: true, s: 0.1, reward: 'sparse' };

/* ───── the engine's local copy of the Bench's generator is the same generator ───── */
{ const RL = require(path.join(root, dir, 'rl_lab.js')); let same = true;
  for (const seed of [1, 5, 11, 100003, 7919 * 13 + 11]) { const a = BN.rng(seed), b = RL.rng(seed), c = BN.rng(seed), d = RL.rng(seed); for (let i = 0; i < 3000; i++) { if (a() !== b()) same = false; if (BN.randn(c) !== RL.randn(d)) same = false; } }
  check(same, 'rl_lab.js reproduces BN.rng and BN.randn exactly'); }

/* ───── the table, the price, the clone ───── */
const SP = { 0.5: spec(0.5), 0.3: spec(0.3), 0.15: spec(0.15), 0.1: spec(0.1) };
F.d40 = SP[0.5].d; F.d70 = SP[0.3].d; F.d234 = SP[0.15].d; F.d494 = SP[0.1].d; F.nodes494 = SP[0.1].nx * SP[0.1].ny; F.grid_nx = SP[0.1].nx; F.grid_ny = SP[0.1].ny;
F.price = PRICE; F.maxatt = MAXATT; F.afternoon = 480; F.per_hour = 3600 / PRICE; F.hours3000 = MAXATT * PRICE / 3600; F.hours480 = 480 * PRICE / 3600; F.pairs_per_update = NPAIR; F.attempts_per_update = 2 * NPAIR; F.edge_cm = EDGE * 100; F.eval_n = EVAL_N;
const P5 = prior(5);
F.clone_frames = P5.D.X.length; { let ss = 0; for (const y of P5.D.Y) ss += y[0] * y[0] + y[1] * y[1]; F.rms_action = r3(Math.sqrt(ss / P5.D.Y.length / 2)); F.sig02_rel = r3(0.2 / F.rms_action); F.sig01_rel = r3(0.1 / F.rms_action); F.sig03_rel = r3(0.3 / F.rms_action); }
F.frames_per_demo = r3(F.clone_frames / 20);
const W5 = world(5, 0), polPrior = policyOf('residual', SP[0.1], new Float64Array(SP[0.1].d), RHO, P5);
F.p0 = successRate(W5, polPrior, EVALSET, true) * 100;                       // the eval set the learning curves use
F.p0_big = successRate(W5, polPrior, BIGSET, true) * 100;                     // 400 fresh runs
{ // fidelity of the tabulated clone: the exact nearest-demo regression on the same 400 runs
  const exact = (q, u) => { const a = kernelAt(P5.D, q[0], q[1]); u[0] = a[0]; u[1] = a[1]; };
  F.p0_exact = successRate(W5, exact, BIGSET, true) * 100;
  const noEdge = successRate(W5, exact, BIGSET, false) * 100; F.p0_exact_noedge = noEdge;
}
{ const ci = BN.stats.wilson(Math.round(F.p0_big / 100 * 400), 400); F.p0_lo = r3(ci[0] * 100); F.p0_hi = r3(ci[1] * 100); }
F.p0_of20 = Math.round(F.p0 / 100 * 20);
{ // d_eff: table entries the clone's own runs read (the others cannot change the score)
  const set = new Set(), T = SP[0.1], r = [0, 0];
  for (let k = 0; k < 100; k++) { const rng = BN.rng(5000 + k), q = BN.slalom.startQ(W5.w, JIT * BN.randn(rng)).slice(); for (let t = 0; t < W5.T; t++) { const p = BN.arm.fk(q, W5.w.body); if (BN.slalom.collide(W5.w, p) || Math.abs(p[1] - W5.row) > EDGE || p[0] > W5.xe - 0.02) break; nodesTouched(T, q, set); polPrior(q, r); q[0] += DT * (clip(r[0], 1.5) + GUST * BN.randn(rng)); q[1] += DT * (clip(r[1], 1.5) + GUST * BN.randn(rng)); } }
  F.nodes_touched = set.size; F.deff = 2 * set.size;
}

/* ───── the estimator against closed forms ───── */
const sgauss = (rng) => BN.randn(rng);
{ // (1) quadratic score: the mirrored estimator is exactly unbiased
  const d = 12, rng = BN.rng(21), a = [], cc = [], th0 = []; for (let i = 0; i < d; i++) { a.push(0.5 + rng()); cc.push(rng() - 0.5); th0.push(rng() - 0.5); }
  const f = (t) => { let s = 0; for (let i = 0; i < d; i++) s -= a[i] * (t[i] - cc[i]) ** 2; return s; };
  const exact = th0.map((t, i) => -2 * a[i] * (t - cc[i])), sig = 0.3, N = 10, M = 20000, mean = new Float64Array(d), rg = BN.rng(22);
  for (let m = 0; m < M; m++) for (let k = 0; k < N; k++) { const e = []; for (let i = 0; i < d; i++) e.push(sgauss(rg)); const tp = th0.map((t, i) => t + sig * e[i]), tm = th0.map((t, i) => t - sig * e[i]), z = (f(tp) - f(tm)) / (2 * sig * N * M); for (let i = 0; i < d; i++) mean[i] += z * e[i]; }
  let num = 0, den = 0; for (let i = 0; i < d; i++) { num += (mean[i] - exact[i]) ** 2; den += exact[i] ** 2; }
  F.quad_err = r3(Math.sqrt(num / den) * 100); check(F.quad_err < 3, 'the mirrored estimator averages to the exact gradient of a quadratic score (relative error ' + F.quad_err + ' %)');
}
{ // (2) a step-function score R = 1[theta . u > 0]: derivative zero except at the jump, but the smoothed score Phi(theta.u / sigma) has gradient phi(theta.u / sigma) / sigma along u
  const d = 8, rng = BN.rng(31), u = []; let nu = 0; for (let i = 0; i < d; i++) { const x = sgauss(rng); u.push(x); nu += x * x; } nu = Math.sqrt(nu); for (let i = 0; i < d; i++) u[i] /= nu;
  const sig = 0.2, off = 0.5 * sig, th0 = u.map((x) => x * off), f = (t) => { let s = 0; for (let i = 0; i < d; i++) s += t[i] * u[i]; return s > 0 ? 1 : 0; };
  const N = 10, M = 40000, mean = new Float64Array(d), rg = BN.rng(32);
  for (let m = 0; m < M; m++) for (let k = 0; k < N; k++) { const e = []; for (let i = 0; i < d; i++) e.push(sgauss(rg)); const tp = th0.map((t, i) => t + sig * e[i]), tm = th0.map((t, i) => t - sig * e[i]), z = (f(tp) - f(tm)) / (2 * sig * N * M); for (let i = 0; i < d; i++) mean[i] += z * e[i]; }
  let along = 0, side = 0; for (let i = 0; i < d; i++) along += mean[i] * u[i]; for (let i = 0; i < d; i++) side += (mean[i] - along * u[i]) ** 2;
  const phi = (x) => Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI), exact = phi(off / sig) / sig;
  F.step_exact = r3(exact); F.step_est = r3(along); F.step_side = r3(Math.sqrt(side));
  check(Math.abs(along - exact) / exact < 0.04 && Math.sqrt(side) < 0.12 * exact, 'a step-function score still has the smoothed gradient phi/sigma along u: ' + along + ' vs ' + exact + ' (off-axis ' + Math.sqrt(side) + ')');
}
{ // (3) cosine law for a linear score: cos(g_hat, g) ~ 1 / sqrt(1 + d/N); shown for the lesson's d and N and for d_eff
  const mc = (d, N, T) => { const rg = BN.rng(41 + d), g = []; let ng = 0; for (let i = 0; i < d; i++) { const x = sgauss(rg); g.push(x); ng += x * x; } ng = Math.sqrt(ng); let acc = 0;
    for (let t = 0; t < T; t++) { const est = new Float64Array(d); for (let k = 0; k < N; k++) { const e = []; let dot = 0; for (let i = 0; i < d; i++) { const x = sgauss(rg); e.push(x); dot += g[i] * x; } for (let i = 0; i < d; i++) est[i] += dot * e[i] / N; }
      let de = 0, ne = 0; for (let i = 0; i < d; i++) { de += est[i] * g[i]; ne += est[i] * est[i]; } acc += de / (ng * Math.sqrt(ne)); } return acc / T; };
  F.cos_pred_494 = r3(1 / Math.sqrt(1 + F.d494 / NPAIR)); F.cos_mc_494 = r3(mc(F.d494, NPAIR, 400));
  F.cos_pred_deff = r3(1 / Math.sqrt(1 + F.deff / NPAIR)); F.cos_mc_deff = r3(mc(F.deff, NPAIR, 400));
  F.cos_pred_40_10 = r3(1 / Math.sqrt(1 + 40 / NPAIR)); F.cos_mc_40_10 = r3(mc(40, NPAIR, 600));
  F.pairs_cos07 = Math.round(F.d494 * 0.49 / 0.51); F.attempts_cos07 = 2 * F.pairs_cos07; F.hours_cos07 = r3(F.attempts_cos07 * PRICE / 3600);
  for (const [k, d, N] of [['494', F.d494, NPAIR], ['deff', F.deff, NPAIR], ['40_10', 40, NPAIR]]) { const p = F['cos_pred_' + k], m = F['cos_mc_' + k]; check(Math.abs(m - p) < 0.06 * p + 0.01, 'cosine law at d=' + d + ', N=' + N + ': ' + m + ' vs ' + p); }
}

/* ───── a zero teaches nothing: the needle ───── */
function needle(n, s, sig, K, edge, seed0) {
  const W = world(n, 0), T = spec(s), th = new Float64Array(T.d), pol = policyOf('scratch', T, th, 0, null), rng = BN.rng(seed0 || 77); let ok = 0;
  for (let k = 0; k < K; k++) { for (let i = 0; i < T.d; i++) th[i] = sig * BN.randn(rng); if (attempt(W, pol, 500000 + k, edge).done) ok++; }
  return ok;
}
F.needle_K = 6000;
for (const [tag, sig] of [['s1', 0.1], ['s2', 0.2], ['s4', 0.4]]) { F['needle_n5_edge_' + tag] = needle(5, 0.1, sig, 6000, true); F['needle_n5_plain_' + tag] = needle(5, 0.1, sig, 6000, false); F['needle_n1_edge_' + tag] = needle(1, 0.1, sig, 6000, true); F['needle_n2_edge_' + tag] = needle(2, 0.1, sig, 6000, true); }
F.needle_n5_plain_s2_pct = r3(F.needle_n5_plain_s2 / 60); F.needle_n5_plain_s4_pct = r3(F.needle_n5_plain_s4 / 60);
F.needle_n1_big_K = 60000; F.needle_n1_big = needle(1, 0.1, 0.2, 60000, true, 1234); F.needle_n1_big_perm = r3(F.needle_n1_big / 6);   // per 10,000 attempts
F.needle_n1_expect = Math.round(60000 / F.needle_n1_big); F.numbers_per_demo = Math.round(F.frames_per_demo * 2); F.cos45_pairs = F.deff; F.cos45_attempts = 2 * F.deff; F.cos45_hours = r3(2 * F.deff * PRICE / 3600);
check(F.needle_n5_edge_s1 === 0 && F.needle_n5_edge_s2 === 0 && F.needle_n5_edge_s4 === 0, 'with the table edge no random table completes the five-post course in 6000 draws (sigma .1/.2/.4)');
check(F.needle_n5_plain_s2 >= 30 && F.needle_n5_plain_s4 >= 300, 'with the edge ignored, random tables complete the course often enough to be found (' + F.needle_n5_plain_s2 + ', ' + F.needle_n5_plain_s4 + ')');
check(F.needle_n1_big > 0 && F.needle_n1_big < 200, 'on one post the needle is thin but present');

{ // scratch + plain score, five posts: nothing ever scores; the update is exactly zero, so theta never leaves zero
  for (const [tag, sg] of [['s1', 0.1], ['s2', 0.2], ['s3', 0.3]]) { const g = group(Object.assign({}, B5, { start: 'scratch' }), sg); F['scr_plain_wins_' + tag] = Math.max(...g.wins); F['scr_plain_tmax_' + tag] = Math.max(...g.runs.map((r) => r.tmax)); F['scr_plain_fin_' + tag] = Math.max(...g.fin);
    check(Math.max(...g.wins) === 0 && Math.max(...g.runs.map((r) => r.tmax)) === 0 && Math.max(...g.fin) === 0, 'scratch + plain score at five posts: no attempt scores and theta stays exactly zero (sigma ' + sg + ')'); }
  F.scr_plain_attempts = MAXATT; F.scr_plain_total = MAXATT * SEEDS.length; F.scr_plain_hours = F.hours3000; F.scr_plain_total_h = F.scr_plain_total * PRICE / 3600;
}
{ // one post, plain score: the needle is thin but the learner finds it, slowly; two posts: not in 3000 attempts
  const g1 = group(Object.assign({}, B5, { n: 1, start: 'scratch' }), 0.2), g1b = group(Object.assign({}, B5, { n: 1, start: 'scratch' }), 0.1), g2 = group(Object.assign({}, B5, { n: 2, start: 'scratch' }), 0.2);
  F.n1_a90_med = g1.med; F.n1_a90_min = g1.min; F.n1_a90_max = g1.max; F.n1_a90_med_h = r3(g1.med / 120); F.n1_never = g1.never; F.n1_first_med = median(g1.first); F.n1_first_min = Math.min(...g1.first); F.n1_first_max = Math.max(...g1.first);
  F.n1_s1_wins = Math.max(...g1b.wins); F.n2_wins = Math.max(...g2.wins);
  check(g1.never === 0 && g1.med >= 600, 'one post, plain score, sigma .2: every seed reaches 90 % (median ' + g1.med + ')'); check(F.n1_s1_wins === 0 && F.n2_wins === 0, 'sigma .1 on one post and sigma .2 on two posts never score in 3000 attempts');
}
{ // the edge ignored (the plain score of lessons 1-11): a detour scores, and a learner finds it
  const gs = [0.1, 0.2, 0.3].map((sg) => group(Object.assign({}, B5, { edge: false, start: 'scratch' }), sg));
  F.noedge_a90_s2 = gs[1].med; F.noedge_a90_s3 = gs[2].med; F.noedge_a90_s2_max = gs[1].max; F.noedge_s1_ok = 5 - gs[0].never; F.noedge_a90_s2_h = r3(gs[1].med / 120);
  check(gs[1].never === 0 && gs[2].never === 0 && gs[1].med <= 300 && gs[0].never >= 3, 'edge ignored: sigma .2 and .3 find the detour within 300 attempts, sigma .1 mostly does not');
}

/* ───── the arms (d = 494, five posts, sigma .1 unless stated) ───── */
const lowest = (r) => Math.round(Math.min(...r.curve.slice(1).map((p) => p[1])) * 100);
const gS = group(Object.assign({}, B5, { reward: 'plus', start: 'scratch' }), 0.1), gF = group(Object.assign({}, B5, { start: 'free' }), 0.1), gR = group(Object.assign({}, B5, { start: 'residual' }), 0.1);
F.scr_plus_med = gS.med; F.scr_plus_min = gS.min; F.scr_plus_max4 = Math.max(...gS.a.filter((x) => x !== Infinity)); F.scr_plus_never = gS.never; F.scr_plus_h = r3(gS.med / 120); F.scr_plus_hmin = r3(gS.min / 120);
F.scr_plus_fin_min = Math.min(...gS.fin);
F.free_med = gF.med; F.free_min = gF.min; F.free_max = gF.max; F.free_h = r3(gF.med / 120); F.free_never = gF.never;
F.res_med = gR.med; F.res_min = gR.min; F.res_max = gR.max; F.res_h = r3(gR.med / 120); F.res_hmin = r3(gR.min / 120); F.res_hmax = r3(gR.max / 120); F.res_fin_min = Math.min(...gR.fin); F.res_never = gR.never;
F.ratio_plus_res = r3(gS.med / gR.med); F.ratio_free_res = r3(gF.med / gR.med); F.ratio_plus_free = r3(gS.med / gF.med);
F.res_wins_med = median(gR.wins); F.res_wins_share = r3(median(gR.wins) / MAXATT * 100); F.scr_plus_wins_med = median(gS.wins);
F.res_low_med = median(gR.runs.map(lowest)); F.free_low_med = median(gF.runs.map(lowest));
check(gR.never === 0 && gR.med <= 480, 'the bounded correction reaches 90 % in an afternoon (<= 480 attempts) on every seed (median ' + gR.med + ')');
check(gS.med >= 3 * gR.med, 'the hinted scratch learner needs at least 3 times the attempts of the bounded correction (' + gS.med + ' vs ' + gR.med + ')');
check(gF.med >= gR.med && gF.med < gS.med, 'the free correction sits between the two (' + gF.med + ')');
check(gS.never >= 1, 'in at least one seed the progress term traps the learner for the whole budget');
F.hours_afternoon_ok = F.hours480;
{ // noise sized for no policy: sigma .2 and .3, free against bounded, 1500 attempts
  const at1500 = (g) => g.runs.map((r) => r.curve[25][1] * 100);       // checkpoint 25 = 1500 attempts
  for (const [tag, sg] of [['s2', 0.2], ['s3', 0.3]]) {
    const f = group(Object.assign({}, B5, { start: 'free' }), sg), r = group(Object.assign({}, B5, { start: 'residual' }), sg);
    F['free_' + tag + '_ok'] = at1500(f).filter((x) => x >= 90).length; F['res_' + tag + '_ok'] = at1500(r).filter((x) => x >= 90).length;
    F['free_' + tag + '_med'] = f.med; F['res_' + tag + '_med'] = r.med; F['free_' + tag + '_low'] = median(f.runs.map(lowest)); F['res_' + tag + '_low'] = median(r.runs.map(lowest));
    F['free_' + tag + '_fin'] = median(at1500(f)); F['free_' + tag + '_wins_min'] = Math.min(...f.wins); F['free_' + tag + '_deadn'] = f.runs.filter((x) => x.curve[25][1] * 100 <= 20).length;
    F['free_' + tag + '_stuck62'] = f.runs.filter((x) => x.curve[25][1] * 100 <= F.p0 + 1e-9 && x.curve[25][1] * 100 >= F.p0 - 1e-9).length;
    { const st = f.runs.filter((x) => Math.abs(x.curve[25][1] * 100 - F.p0) < 1e-9); F['free_' + tag + '_stuck_wins'] = st.length ? Math.max(...st.map((x) => x.winlog[25])) : 0; F['free_' + tag + '_stuck_tmax'] = st.length ? Math.max(...st.map((x) => Math.max(...x.curve.slice(0, 26).map((p) => p[1] * 100)) - Math.min(...x.curve.slice(0, 26).map((p) => p[1] * 100)))) : 0; }
  }
  check(F.res_s2_ok === 5 && F.res_s3_ok === 5 && F.free_s2_ok <= 3 && F.free_s3_ok <= 2, 'at sigma .2 and .3 the bounded correction recovers on all seeds and the free one does not (' + F.free_s2_ok + ', ' + F.free_s3_ok + ' of 5)');
  check(F.free_s3_stuck62 >= 1 && F.free_s3_stuck_wins === 0 && F.free_s3_stuck_tmax === 0, 'at sigma .3 the seeds that stay at the clone\'s success had no scoring attempt at all and never moved (' + F.free_s3_stuck_wins + ', ' + F.free_s3_stuck_tmax + ')');
  check(F.free_s2_low <= 1 && F.res_s2_low <= 12, 'the free correction is driven to the floor at sigma .2, the bounded one dips and returns (' + F.free_s2_low + ', ' + F.res_s2_low + ')');
}

/* ───── the table size ───── */
{
  const rows = [['40', 0.5], ['70', 0.3], ['234', 0.15], ['494', 0.1]];
  for (const [tag, s] of rows) {
    const gs = tag === '494' ? gS : group(Object.assign({}, B5, { reward: 'plus', s, start: 'scratch' }), 0.1), gr = tag === '494' ? gR : group(Object.assign({}, B5, { s, start: 'residual' }), 0.1);
    F['dsw_scr_' + tag] = gs.med; F['dsw_res_' + tag] = gr.med; F['dsw_res_never_' + tag] = gr.never; F['dsw_scr_never_' + tag] = gs.never;
  }
  check(F.dsw_scr_40 < F.dsw_scr_70 && F.dsw_scr_70 < F.dsw_scr_234 && F.dsw_scr_234 < F.dsw_scr_494, 'the hinted scratch learner gets slower as the table grows');
  check(F.dsw_res_494 < F.dsw_scr_494 && F.dsw_res_234 < F.dsw_scr_234 && F.dsw_res_40 > F.dsw_scr_40, 'the crossing: scratch wins on the smallest table, the bounded correction on the larger ones');
}

/* ───── other settings of the learner keep the order ───── */
{
  const alts = [{ sigma: 0.05 }, { sigma: 0.2 }, { sigma: 0.1, eta: 1 }, { sigma: 0.1, eta: 4 }, { sigma: 0.1, N: 5 }, { sigma: 0.1, N: 15 }], sm = [], rm = [];
  for (const a of alts) { const gs = group(Object.assign({}, B5, { reward: 'plus', start: 'scratch' }, a)), gr = group(Object.assign({}, B5, { start: 'residual' }, a)); sm.push(gs.med); rm.push(gr.med); }
  F.rob_scr_min = Math.min(...sm); F.rob_scr_max = Math.max(...sm); F.rob_res_min = Math.min(...rm); F.rob_res_max = Math.max(...rm); F.rob_ratio_min = r3(Math.min(...sm.map((x, i) => x / rm[i]))); F.rob_ratio_max = r3(Math.max(...sm.map((x, i) => x / rm[i])));
  check(sm.every((x, i) => x > rm[i]) && F.rob_ratio_min >= 1.5, 'in six other settings of noise, step size and pairs per update the progress term never beats the bounded clone (min ratio ' + F.rob_ratio_min + ')');
}

/* ───── where it stops: a correction belongs to its task ───── */
{
  const T5 = SP[0.1], zero = new Float64Array(T5.d), pol0 = policyOf('residual', T5, zero, RHO, P5);
  for (const cm of [0, 1, 2, 3, 4, 6, 8]) F['prior_shift_' + cm] = Math.round(successRate(world(5, cm / 100), pol0, BIGSET.slice(0, 200), true) * 100);
  const m4 = group(Object.assign({}, B5, { shift: 0.04, start: 'residual' }), 0.1), m8 = group(Object.assign({}, B5, { shift: 0.08, start: 'residual' }), 0.1);
  F.res_m4_med = m4.med; F.res_m4_min = m4.min; F.res_m4_max = m4.max; F.res_m8_med = m8.med; F.res_m8_min = m8.min; F.res_m8_max = m8.max; F.res_m4_h = r3(m4.med / 120); F.res_m8_h = r3(m8.med / 120);
  F.res_first_med = median(gR.first); F.res_m4_first_med = median(m4.first); F.res_m8_first_med = median(m8.first); F.res_m4_never = m4.never; F.res_m8_never = m8.never; F.res_m4_p0 = r3(m4.runs[0].curve[0][1] * 100); F.res_m8_p0 = r3(m8.runs[0].curve[0][1] * 100);
  F.layout_each_h = r3((F.res_med + m4.med + m8.med) / 3 / 120);
  // carry the correction learned on the table moved by 8 cm back to the table it was cloned on, and the reverse
  const xs = [];
  for (const sd of SEEDS) {
    const A = learn(Object.assign({}, B5, { shift: 0.08, start: 'residual', sigma: 0.1, seed: sd, keep: true })), Bn = learn(Object.assign({}, B5, { shift: 0, start: 'residual', sigma: 0.1, seed: sd, keep: true }));
    const thA = Float64Array.from(A.theta), thB = Float64Array.from(Bn.theta);
    xs.push({ a_on_a: successRate(world(5, 0.08), policyOf('residual', T5, thA, RHO, P5), BIGSET.slice(0, 200), true) * 100, a_on_0: successRate(world(5, 0), policyOf('residual', T5, thA, RHO, P5), BIGSET.slice(0, 200), true) * 100,
      b_on_b: successRate(world(5, 0), policyOf('residual', T5, thB, RHO, P5), BIGSET.slice(0, 200), true) * 100, b_on_8: successRate(world(5, 0.08), policyOf('residual', T5, thB, RHO, P5), BIGSET.slice(0, 200), true) * 100 });
  }
  const mean = (k) => xs.reduce((s, x) => s + x[k], 0) / xs.length;
  F.xfer_a_on_a = r3(mean('a_on_a')); F.xfer_a_on_0 = r3(mean('a_on_0')); F.xfer_b_on_b = r3(mean('b_on_b')); F.xfer_b_on_8 = r3(mean('b_on_8')); F.xfer_a_on_0_max = Math.max(...xs.map((x) => x.a_on_0));
  check(F.prior_shift_0 > 50 && F.prior_shift_4 === 0 && F.prior_shift_8 === 0 && F.prior_shift_2 < F.prior_shift_0 && F.prior_shift_3 < F.prior_shift_2, 'the clone is right for the table it was recorded on and loses everything by 4 cm');
  check(m4.never === 0 && m8.never === 0 && m4.med <= 900 && m8.med <= 900, 'each moved table is repaired within a few hundred attempts');
  check(F.xfer_a_on_a > 95 && F.xfer_b_on_b > 95 && F.xfer_a_on_0 < 5 && F.xfer_b_on_8 < 20, 'a correction completes its own table and fails the other (' + F.xfer_a_on_0 + ', ' + F.xfer_b_on_8 + ')');
}

/* ───── what real systems spent, in the lesson's own currency (arithmetic only; the systems' own numbers are quoted in the prose from their papers) ───── */
F.qtopt_attempts = 580000; F.qtopt_hours = 800; F.qtopt_s_per_grasp = r3(800 * 3600 / 580000); F.qtopt_hours_at_price = Math.round(580000 * PRICE / 3600); F.qtopt_days_at_price = r3(580000 * PRICE / 3600 / 24);
F.levine_attempts = 800000; F.levine_hours_at_price = Math.round(800000 * PRICE / 3600); F.levine_years_at_price = r3(800000 * PRICE / 3600 / 8 / 250);
F.johannink_samples = 8000; F.demo_numbers = F.clone_frames * 2; F.score_numbers_per_20 = 20;
F.ck_attempts = Math.round((F.res_med + F.res_m4_med + F.res_m8_med) / 3); F.ck_hours = r3(F.ck_attempts * PRICE / 3600); F.ck_tasks = 10; F.ck_total_hours = r3(10 * F.ck_attempts * PRICE / 3600);
F.ck_a = r3(Math.pow(0.999, 20)); F.ck_b = 1000; F.ck_b_h = r3(1000 * PRICE / 3600); F.ck_c_inv = Math.round(1 / Math.pow(0.4, 20)); F.ck_c_att = Math.round(1 / 0.001);

/* ───── the widget prints the same numbers ───── */
const html = path.join(root, dir, '12_reward_as_teacher.html');
if (fs.existsSync(html)) {
  const pg = loadPage(html);
  pg.problems.forEach((p) => fail('page problem: ' + p));
  const SCORES = { plain: { reward: 'sparse', edge: true }, plus: { reward: 'plus', edge: true }, noedge: { reward: 'sparse', edge: false } };
  const TASKS = { n5: { n: 5, shift: 0 }, n1: { n: 1, shift: 0 }, m4: { n: 5, shift: 0.04 }, m8: { n: 5, shift: 0.08 } };
  const cfgOf = (st) => Object.assign({ s: st.size }, SCORES[st.score], TASKS[st.task], { start: st.start });
  const eqd = (id, want, digits, what) => { const got = pg.num(id); if (!(Math.abs(got - want) <= 0.5 * Math.pow(10, -digits) + 1e-9)) fail(`${what}: widget #${id} prints ${got}, independent computation gives ${want.toFixed(digits + 2)}`); };
  const ids = { start: 'w12-start', score: 'w12-score', size: 'w12-size', task: 'w12-task', sigma: 'w12-sigma', att: 'w12-att' };
  const cur = { start: 'scratch', score: 'plain', size: 0.1, task: 'n5', sigma: 0.1, att: 3000 };      // the page's initial state
  const setState = (st) => {                              // change only what differs, then let the five learners finish (one checkpoint per frame)
    for (const k of ['start', 'score', 'size', 'task', 'sigma', 'att']) if (st[k] !== cur[k]) { pg.set(ids[k], String(st[k])); cur[k] = st[k]; }
    for (let i = 0; i < 600 && pg.text('w12-status') !== ''; i++) pg.drain();
    check(pg.text('w12-status') === '', 'the widget finishes its five learners');
  };
  const probe = (st, tag) => {
    setState(st);
    const c = cfgOf(st), g = group(c, st.sigma), idx = Math.round(st.att / CK), T = spec(st.size);
    const at = g.runs.map((r) => r.curve[idx][1] * 100), wn = g.runs.map((r) => r.winlog[idx]);
    eqd('w12-succ', median(at), 0, tag + ' success at this many attempts'); eqd('w12-hours', st.att * PRICE / 3600, 1, tag + ' robot hours');
    eqd('w12-wins', median(wn), 0, tag + ' attempts that scored'); eqd('w12-d', T.d, 0, tag + ' table numbers');
    const rtxt = pg.text('w12-range'), nums = (rtxt.match(/[\d.]+/g) || []).map(Number); check(nums.length >= 2 && Math.abs(nums[0] - Math.min(...at)) < 0.51 && Math.abs(nums[1] - Math.max(...at)) < 0.51, tag + ' range prints "' + rtxt + '", independent computation gives ' + Math.min(...at) + '-' + Math.max(...at));
    const atxt = pg.text('w12-a90'); if (g.med === Infinity) check(/not within/i.test(atxt), tag + ' a90 should say it is not reached, prints "' + atxt + '"'); else eqd('w12-a90', g.med, 0, tag + ' attempts to 90 %');
    const htxt = pg.text('w12-a90h'); if (g.med === Infinity) check(/more than|over|>/i.test(htxt), tag + ' hours to 90 % should say more than the budget, prints "' + htxt + '"'); else eqd('w12-a90h', g.med * PRICE / 3600, 1, tag + ' robot hours to 90 %');
    const p0 = pg.text('w12-p0'); if (st.start === 'scratch') check(/none|no prior|—|-/i.test(p0), tag + ' prior success should be absent for scratch, prints "' + p0 + '"'); else eqd('w12-p0', g.runs[0].curve[0][1] * 100, 0, tag + ' success of the clone before any attempt');
  };
  const D = { start: 'scratch', score: 'plain', size: 0.1, task: 'n5', sigma: 0.1, att: 3000 };
  const S = (o) => Object.assign({}, D, o);
  probe(S({}), 'default (scratch, plain score, 3000 attempts)');
  probe(S({ att: 1200 }), 'scratch at 1200 attempts');
  probe(S({ start: 'residual' }), 'bounded correction');
  probe(S({ start: 'residual', att: 60 }), 'bounded correction after 60 attempts');
  probe(S({ start: 'residual', att: 0 }), 'bounded correction at 0 attempts');
  probe(S({ start: 'free' }), 'free correction');
  probe(S({ score: 'plus' }), 'scratch with the progress term');
  probe(S({ start: 'free', sigma: 0.3 }), 'free correction at sigma .3');
  probe(S({ start: 'residual', sigma: 0.3 }), 'bounded correction at sigma .3');
  probe(S({ start: 'free', sigma: 0.2 }), 'free correction at sigma .2');
  probe(S({ size: 0.5, score: 'plus' }), 'smallest table, scratch with progress');
  probe(S({ size: 0.5, start: 'residual' }), 'smallest table, bounded correction');
  probe(S({ size: 0.15, start: 'residual' }), 'table of 234, bounded correction');
  probe(S({ task: 'n1', sigma: 0.2 }), 'one post, scratch, sigma .2');
  probe(S({ score: 'noedge', sigma: 0.2 }), 'edge ignored, scratch, sigma .2');
  probe(S({ task: 'm4', start: 'residual' }), 'table moved 4 cm, bounded correction');
  probe(S({ task: 'm8', start: 'residual' }), 'table moved 8 cm, bounded correction');
  probe(S({ task: 'm8', start: 'residual', att: 0 }), 'table moved 8 cm, clone alone');
}

if (process.env.ORC && cacheFile) { try { fs.writeFileSync(cacheFile, JSON.stringify(disk)); } catch (e) { /* the cache is a convenience */ } }
console.log(JSON.stringify({ facts: F }));
process.exit(bad ? 1 : 0);
