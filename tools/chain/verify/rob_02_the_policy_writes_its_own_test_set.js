#!/usr/bin/env node
'use strict';
/* Oracle for robot_model_training lesson 02 (the policy writes its own test set).
 * Re-derives every number the lesson quotes with code written separately from loop_lab.js: a brute-force kernel regressor and nearest-frame search (no grid
 * hashing, typed arrays), its own rollout loop and plant, its own bins, drift, cost curve and log-log fit.  Only the world's primitives (arm, expert, collision,
 * path) come from bench.js.  Then it drives the page's widget and checks that what it prints is what the independent computation gives.
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

/* ───── the experiment, written out independently ───── */
const H = 0.02, DT = 0.05, JIT = 0.01, NCLONE = 200, NEXP = 100, NHELD = 10, TUBE = 0.04, NB = 5;
const EDGES = [0, 0.5, 1, 1.5, 2, 3];
function gaussStep(q, u, noise, rng) {
  const c = [Math.max(-1.5, Math.min(1.5, u[0])), Math.max(-1.5, Math.min(1.5, u[1]))];
  const n0 = noise ? noise * BN.randn(rng) : 0, n1 = noise ? noise * BN.randn(rng) : 0;
  q[0] += DT * (c[0] + n0); q[1] += DT * (c[1] + n1);
}
function run(w, pi, rng, noise, T) {                      // one rollout with everything the statistics need
  const dy = JIT * BN.randn(rng), q = BN.slalom.startQ(w, dy).slice(), S = [], A = [], dev = [], xe = BN.slalom.xEnd(w);
  let coll = false, done = false, steps = T;
  for (let t = 0; t < T; t++) {
    const p = BN.arm.fk(q, w.body); S.push(q.slice()); dev.push(Math.abs(p[1] - BN.slalom.yref(w, p[0])));
    if (BN.slalom.collide(w, p)) { coll = true; steps = t; break; }
    if (p[0] > xe - 0.02) { done = true; steps = t; break; }
    A.push(pi(q)); gaussStep(q, A[A.length - 1], noise, rng);
  }
  return { S, A, dev, coll, done, steps };
}
function store(w, m, noise) {                             // m expert runs from jittered starts, one shared random stream, as typed arrays
  const rng = BN.rng(1), T = BN.slalom.horizon(w), X0 = [], X1 = [], Y0 = [], Y1 = [];
  for (let k = 0; k < m; k++) { const r = run(w, (q) => BN.slalom.expertAct(w, q), rng, noise, T); for (let t = 0; t < r.A.length; t++) { X0.push(r.S[t][0]); X1.push(r.S[t][1]); Y0.push(r.A[t][0]); Y1.push(r.A[t][1]); } }
  return { n: X0.length, X0: Float64Array.from(X0), X1: Float64Array.from(X1), Y0: Float64Array.from(Y0), Y1: Float64Array.from(Y1) };
}
function kernelPolicy(D) {                                // weight every stored frame; zero weight beyond 3 bandwidths; nearest frame if none is near
  return (q) => {
    let sw = 0, a0 = 0, a1 = 0;
    for (let i = 0; i < D.n; i++) {
      const dx = D.X0[i] - q[0]; if (dx > 3 * H || dx < -3 * H) continue;
      const dy = D.X1[i] - q[1], e = (dx / H) * (dx / H) + (dy / H) * (dy / H);
      if (e <= 9) { const w = Math.exp(-0.5 * e); sw += w; a0 += w * D.Y0[i]; a1 += w * D.Y1[i]; }
    }
    if (sw >= 1e-12) return [a0 / sw, a1 / sw];
    let best = Infinity, bi = 0;
    for (let i = 0; i < D.n; i++) { const e = ((D.X0[i] - q[0]) / H) ** 2 + ((D.X1[i] - q[1]) / H) ** 2; if (e < best) { best = e; bi = i; } }
    return [D.Y0[bi], D.Y1[bi]];
  };
}
function dnear(D, q) {                                    // distance to the nearest stored frame in bandwidths, capped at 3
  let best = Infinity;
  for (let i = 0; i < D.n; i++) {
    const dx = D.X0[i] - q[0]; if (dx > 3 * H || dx < -3 * H) continue;
    const dy = D.X1[i] - q[1], e = (dx / H) * (dx / H) + (dy / H) * (dy / H); if (e < best) best = e;
  }
  return best > 9 ? 3 : Math.sqrt(best);
}
const binOf = (d) => { let b = 0; while (b < NB - 1 && d >= EDGES[b + 1]) b++; return b; };

function walk(w, D, rolls, withErr) {                     // spread over d, copy error by d, drift of d, per bin
  const bins = []; for (let i = 0; i < NB; i++) bins.push({ n: 0, se: 0, ss: 0, dd: 0, ds: 0, m: 0 });
  for (const ro of rolls) {
    const d = ro.S.map((q) => dnear(D, q));
    for (let t = 0; t < ro.A.length; t++) {
      const b = bins[binOf(d[t])]; b.n++;
      if (withErr) { const a = BN.slalom.expertAct(w, ro.S[t]); b.se += (ro.A[t][0] - a[0]) ** 2 + (ro.A[t][1] - a[1]) ** 2; b.ss += a[0] * a[0] + a[1] * a[1]; }
    }
    for (let t = 0; t + 1 < d.length; t++) { const b = bins[binOf(d[t])]; b.dd += d[t + 1] - d[t]; b.ds += d[t]; b.m++; }
  }
  let tot = 0, se = 0, ss = 0; bins.forEach((b) => { tot += b.n; se += b.se; ss += b.ss; });
  return { err: withErr ? Math.sqrt(se / ss) * 100 : NaN, bins: bins.map((b) => ({ share: b.n / tot * 100, err: withErr && b.ss > 0 ? Math.sqrt(b.se / b.ss) * 100 : NaN, meanD: b.m ? b.ds / b.m : NaN, drift: b.m ? b.dd / b.m : NaN, pull: b.m ? -(b.dd / b.m) / (b.ds / b.m) * 100 : NaN, m: b.m })) };
}
function costTotal(rolls, T) {                            // expected steps lost among the first T: collided, farther than the tube, or never finished
  let lostSum = 0;
  for (const r of rolls) {
    let lost = 0;
    for (let t = 0; t < T; t++) {
      let b = r.coll && t >= r.steps;
      if (!b && t < r.dev.length && r.dev[t] > TUBE) b = true;
      if (!b && !r.done && !r.coll && t >= r.dev.length) b = true;
      if (b) lost++;
    }
    lostSum += lost;
  }
  return lostSum / rolls.length;
}
function loglog(xs, ys) {                                 // least-squares slope of ln y on ln x
  const lx = xs.map(Math.log), ly = ys.map(Math.log), n = xs.length, mx = lx.reduce((a, b) => a + b) / n, my = ly.reduce((a, b) => a + b) / n;
  let sxx = 0, sxy = 0, syy = 0; for (let i = 0; i < n; i++) { sxx += (lx[i] - mx) ** 2; sxy += (lx[i] - mx) * (ly[i] - my); syy += (ly[i] - my) ** 2; }
  return { slope: sxy / sxx, r2: sxy * sxy / (sxx * syy) };
}

const cache = {};
function setting(n, m, dn, gust, withExpert) {            // everything lesson 2 reports for one setting
  const key = [n, m, dn, gust, withExpert].join('|'); if (cache[key]) return cache[key];
  const w = BN.slalom.world(n), T = BN.slalom.horizon(w), D = store(w, m, dn), pi = kernelPolicy(D);
  const re = BN.rng(5), clone = []; for (let k = 0; k < NCLONE; k++) clone.push(run(w, pi, re, gust, T));
  const succ = clone.filter((r) => r.done).length / NCLONE * 100;
  const out = { n, m, T, frames: D.n, succ, C: costTotal(clone, T) }; out.h = 2 * out.C / (T * T);
  if (withExpert) {
    const rx = BN.rng(5), exp = []; for (let k = 0; k < NEXP; k++) exp.push(run(w, (q) => BN.slalom.expertAct(w, q), rx, gust, T));
    const rv = BN.rng(99), held = []; for (let k = 0; k < NHELD; k++) { const r = run(w, (q) => BN.slalom.expertAct(w, q), rv, dn, T); held.push({ S: r.S, A: r.A.map((u, t) => pi(r.S[t])) }); }
    out.own = walk(w, D, clone, true); out.exp = walk(w, D, exp, false); out.held = walk(w, D, held, true);
    out.beyond = { own: out.own.bins[2].share + out.own.bins[3].share + out.own.bins[4].share, exp: out.exp.bins[2].share + out.exp.bins[3].share + out.exp.bins[4].share, held: out.held.bins[2].share + out.held.bins[3].share + out.held.bins[4].share };
    out.expertSucc = exp.filter((r) => r.done).length / NEXP * 100; out.expertCost = costTotal(exp, T);
  }
  return (cache[key] = out);
}

/* ───── the numbers the lesson quotes ───── */
const d5 = setting(5, 20, 0, 0.05, true);
F._T = d5.T; F._frames = d5.frames; F.succ = d5.succ; F.copy = d5.held.err; F.own = d5.own.err; F.ratio = d5.own.err / d5.held.err;
F.exp_succ = d5.expertSucc; F.exp_cost = d5.expertCost;
{ // the width of a bandwidth at the cup at the start of the course (as lesson 1 states it): 0.02 rad times the cup's distance from the base
  const w = BN.slalom.world(5), x0 = BN.slalom.xStart(); F.h_cm = 0.02 * Math.hypot(x0, BN.slalom.yref(w, x0)) * 100;
}
for (let b = 0; b < NB; b++) { F['sh_held_' + b] = d5.held.bins[b].share; F['sh_exp_' + b] = d5.exp.bins[b].share; F['sh_own_' + b] = d5.own.bins[b].share; F['er_own_' + b] = d5.own.bins[b].err; F['md_own_' + b] = d5.own.bins[b].meanD; }
F.er_held_0 = d5.held.bins[0].err; F.md_held_0 = d5.held.bins[0].meanD;
F.within1_exp = d5.exp.bins[0].share + d5.exp.bins[1].share;
F.beyond_own = d5.beyond.own; F.beyond_held = d5.beyond.held; F.beyond_exp = d5.beyond.exp;
F.within_own = d5.own.bins[0].share; F.within_held = d5.held.bins[0].share; F.within_exp = d5.exp.bins[0].share;
// the error curve: least-squares line through (mean d, error) of the five bins of the clone's own frames
{ const xs = d5.own.bins.map((b) => b.meanD), ys = d5.own.bins.map((b) => b.err), f = BN.stats.linfit(xs, ys); F.err_slope = f.slope; F.err_icpt = f.intercept; F.err_r2 = f.r2; F.line_held_0 = f.intercept + f.slope * F.md_held_0; }
{ let s2 = 0; d5.own.bins.forEach((b) => { s2 += b.share / 100 * b.err * b.err; }); F.own_recon = Math.sqrt(s2); }
{ let s2 = 0; d5.held.bins.forEach((b) => { if (b.share > 0 && !isNaN(b.err)) s2 += b.share / 100 * b.err * b.err; }); F.held_recon = Math.sqrt(s2); }
// pull-back in the bin 0.5-1 bandwidth
F.pull_exp = d5.exp.bins[1].pull; F.pull_clone = d5.own.bins[1].pull; F.push_clone = -d5.own.bins[1].pull;
F.J_exp = 1 - F.pull_exp / 100; F.J_clone = 1 - F.pull_clone / 100;
F.m_exp1 = d5.exp.bins[1].m; F.m_clone1 = d5.own.bins[1].m;
// the gust in bandwidths, and the spread an AR(1) displacement reaches with and without pull-back (closed form, then a Monte Carlo check)
const gustBw = 0.05 * DT / H; F.gust_bw = gustBw;
F.spread100_clone = gustBw * Math.sqrt(100);
F.spread_exp_inf = gustBw / Math.sqrt(1 - F.J_exp * F.J_exp);
F.spread100_cm = F.spread100_clone * F.h_cm; F.spread_exp_cm = F.spread_exp_inf * F.h_cm;
{ const r = BN.rng(7); const sim = (J, steps, N) => { let s2 = 0; for (let k = 0; k < N; k++) { let e = 0; for (let t = 0; t < steps; t++) e = J * e + gustBw * BN.randn(r); s2 += e * e; } return Math.sqrt(s2 / N); };
  F.mc_clone = sim(1, 100, 20000); F.mc_exp = sim(F.J_exp, 400, 20000);
  check(Math.abs(F.mc_clone - F.spread100_clone) < 0.04 * F.spread100_clone, 'random walk spread after 100 steps matches gust*sqrt(100): ' + F.mc_clone + ' vs ' + F.spread100_clone);
  check(Math.abs(F.mc_exp - F.spread_exp_inf) < 0.04 * F.spread_exp_inf, 'AR(1) spread matches its closed form: ' + F.mc_exp + ' vs ' + F.spread_exp_inf); }
// checkpoint: a policy with 0.04 rad/s gust per joint
{ const g = 0.04 * DT / H; F.ck_step = g; F.ck_walk = g * 10; F.ck_pull = g / Math.sqrt(1 - F.J_exp * F.J_exp); F.ck_ratio = F.ck_walk / F.ck_pull; }
// the cost across course lengths
const pts = [];
for (let n = 1; n <= 6; n++) { const s = setting(n, 20, 0, 0.05, false); pts.push(s); F['T' + n] = s.T; F['succ' + n] = s.succ; F['c' + n] = s.C; F['lf' + n] = s.C / s.T * 100; F['h' + n] = s.h * 1000; }
{ const f = loglog(pts.map((p) => p.T), pts.map((p) => p.C)); F.slope_courses = f.slope; F.r2_courses = f.r2; }
{ const hs = pts.map((p) => p.h * 1000), mean = hs.reduce((a, b) => a + b) / hs.length; F.h_mean = mean; F.h_dev = Math.max(...hs.map((x) => Math.abs(x / mean - 1))) * 100; F.inv_h = 1000 / mean; }
F.ck_h = 0.001; F.ck_T = 100; F.ck_C = 0.001 * 100 * 100 / 2; F.ck_C2 = 0.001 * 200 * 200 / 2; F.ck_exact = 100 - (1 - 0.001) * (1 - Math.pow(0.999, 100)) / 0.001;
// more data of the same kind, and data recorded under gusts, and the gust at run time
const m80 = setting(5, 80, 0, 0.05, true), m5 = setting(5, 5, 0, 0.05, true), r05 = setting(5, 20, 0.05, 0.05, true), r10 = setting(5, 20, 0.10, 0.05, true), g0 = setting(5, 20, 0, 0, true), g8 = setting(5, 20, 0, 0.08, true);
F.succ80 = m80.succ; F.own80 = m80.own.err; F.copy80 = m80.held.err; F.beyond80 = m80.beyond.own; F.pull_m80 = m80.own.bins[1].pull; F.push80 = -m80.own.bins[1].pull; F.C80 = m80.C; F.h80 = m80.h * 1000; F._frames80 = m80.frames;
F.succ_m5 = m5.succ; F.own_m5 = m5.own.err; F.copy_m5 = m5.held.err; F.beyond_m5 = m5.beyond.own; F.pull_m5 = m5.own.bins[1].pull; F.C_m5 = m5.C;
F.succ_r05 = r05.succ; F.own_r05 = r05.own.err; F.copy_r05 = r05.held.err; F.beyond_r05 = r05.beyond.own; F.pull_r05 = r05.own.bins[1].pull; F.C_r05 = r05.C; F.h_r05 = r05.h * 1000;
F.m_r10 = r10.own.bins[1].m; F.sh1_r10 = r10.own.bins[1].share;
F.succ_r10 = r10.succ; F.own_r10 = r10.own.err; F.copy_r10 = r10.held.err; F.beyond_r10 = r10.beyond.own; F.pull_r10 = r10.own.bins[1].pull; F.C_r10 = r10.C; F.h_r10 = r10.h * 1000;
F.succ_g0 = g0.succ; F.C_g0 = g0.C; F.beyond_g0 = g0.beyond.own; F.own_g0 = g0.own.err; F.h_g0 = g0.h * 1000;
F.succ_g8 = g8.succ; F.C_g8 = g8.C; F.beyond_g8 = g8.beyond.own; F.own_g8 = g8.own.err; F.h_g8 = g8.h * 1000;
// a smooth fit on the same demonstrations: the lesson's setting (300 features, length scale 0.1 rad) and four others (100 and 1000 features; length scales 0.05 and 0.2 rad)
{ const w = BN.slalom.world(5), D = store(w, 20, 0), X = [], Y = []; for (let i = 0; i < D.n; i++) { X.push([D.X0[i], D.X1[i]]); Y.push([D.Y0[i], D.Y1[i]]); }
  const fit = (nf, ls) => { const m = new BN.RFF(2, 2, nf, ls, 0.01, 1); m.add(X, Y); m.solve();
    let se = 0, ss = 0; for (let i = 0; i < D.n; i++) { const q = m.predict(X[i]); se += (q[0] - Y[i][0]) ** 2 + (q[1] - Y[i][1]) ** 2; ss += Y[i][0] ** 2 + Y[i][1] ** 2; }
    const ev = BN.evaluate(w, () => (q) => Array.from(m.predict(q)), NCLONE, 5, { noise: 0.05, jit: JIT });
    return { train: Math.sqrt(se / ss) * 100, succ: ev.succ * 100 }; };
  const main = fit(300, 0.10); F.rff_train = main.train; F.rff_succ = main.succ;
  const all = [main, fit(100, 0.10), fit(1000, 0.10), fit(300, 0.05), fit(300, 0.20)];
  F.rff_succ_min = Math.min(...all.map((r) => r.succ)); F.rff_succ_max = Math.max(...all.map((r) => r.succ)); F.rff_train_max = Math.max(...all.map((r) => r.train)); }

/* ───── claims of the prose, asserted ───── */
check(F.within_held >= 99, 'held-out expert frames sit within half a bandwidth of the data (got ' + F.within_held + ')');
check(F.within_own < 50 && F.beyond_own > 20, 'the clone\'s own frames are spread out (within half: ' + F.within_own + ', beyond one: ' + F.beyond_own + ')');
check(F.beyond_exp < 1 && F.within_exp > 90, 'the expert under the same gusts stays near the data');
for (let b = 1; b < NB; b++) check(F['er_own_' + b] > F['er_own_' + (b - 1)], 'copy error rises with distance from the data, bin ' + b);
check(F.err_slope > 11 && F.err_slope < 16 && F.err_r2 > 0.98, 'error grows by about 13-14 points per bandwidth (slope ' + F.err_slope + ', r2 ' + F.err_r2 + ')');
check(Math.abs(F.own_recon - F.own) / F.own < 0.03, 'the shares and bin errors rebuild the own-frame error to within 3 % (' + F.own_recon + ' vs ' + F.own + ')');
check(F.ratio > 3.8 && F.ratio < 4.4, 'own-frame error is about four times the held-out error');
check(F.pull_exp > 5 && F.pull_exp < 10 && F.m_exp1 > 1000, 'the expert recovers 5-10 % of its distance per step in the 0.5-1 bin (' + F.pull_exp + ')');
check(Math.abs(F.pull_clone) < 0.5 && F.m_clone1 > 5000, 'the clone recovers nothing there (' + F.pull_clone + ')');
check(F.slope_courses > 1.9 && F.slope_courses < 2.1 && F.r2_courses > 0.98, 'lost steps grow as the square of the horizon across courses (slope ' + F.slope_courses + ')');
check(F.h_dev < 15, 'the hazard 2C/T^2 is the same at every course length to within 15 % (' + F.h_dev + ')');
check(F.exp_cost < 0.5 && F.exp_succ === 100, 'the expert under the same gusts loses no steps');
check(Math.abs(F.succ80 - F.succ) < 3 && Math.abs(F.own80 - F.own) < 1.5 && Math.abs(F.beyond80 - F.beyond_own) < 2.5 && Math.abs(F.C80 - F.c5) / F.c5 < 0.2, 'four times the calm demonstrations leave everything where it was');
check(F.succ_m5 < F.succ - 5, 'five demonstrations are fewer than the clone needs');
check(F.succ_r05 > F.succ + 15 && F.succ_r10 > F.succ + 30 && F.beyond_r05 < 10 && F.beyond_r10 < 1, 'demonstrations recorded under gusts widen the data and lift success');
check(F.pull_r05 > 1.5 && F.pull_r10 > 8, 'demonstrations recorded under gusts teach a pull-back (' + F.pull_r05 + ', ' + F.pull_r10 + ')');
check(F.copy_r05 > F.copy && F.copy_r10 > F.copy_r05, 'the old scorecard gets worse as the demonstrations get noisier');
check(F.succ_g0 >= 90 && F.succ_g8 <= 40, 'no gust: success >= 90 %; gust 0.08: <= 40 %');
check(F.rff_succ_max < 90 && F.rff_succ_max - F.rff_succ_min > 30 && F.rff_train_max < 2.5, 'over five smooth-fit settings the training error stays small, the success moves a great deal and never reaches the expert (' + F.rff_train_max + ', ' + F.rff_succ_min + ' to ' + F.rff_succ_max + ')');
check(Math.abs(F.line_held_0 - F.er_held_0) < 0.5 && F.md_held_0 < 0.05, 'the held-out expert frames lie on the error line of the clone\'s own frames (' + F.er_held_0 + ' vs ' + F.line_held_0 + ' at d = ' + F.md_held_0 + ')');
check(F.m_r10 < 2000 && F.sh1_r10 < 5, 'the pull-back of the clone recorded under gusts of 0.10 rests on few steps in a rarely visited bin (' + F.m_r10 + ', ' + F.sh1_r10 + ' %)');
check(F.rff_train < 1.5 && F.rff_succ > 55 && F.rff_succ < 80, 'a smooth fit with under 1.5 % training error completes 55-80 % of runs (' + F.rff_train + ', ' + F.rff_succ + ')');
check(Math.abs(F.ck_exact - F.ck_C) / F.ck_C < 0.05, 'the first-order cost matches the exact geometric sum for small hT');

/* ───── the widget prints the same numbers ───── */
const html = path.join(root, dir, '02_the_policy_writes_its_own_test_set.html');
if (fs.existsSync(html)) {
  const pg = loadPage(html);
  pg.problems.forEach((p) => fail('page problem: ' + p));
  const eqd = (id, want, digits, what) => { const got = pg.num(id); if (!(Math.abs(got - want) <= 0.5 * Math.pow(10, -digits) + 1e-9)) fail(`${what}: widget #${id} prints ${got}, independent computation gives ${want.toFixed(digits + 2)}`); };
  const DEMOS = [5, 10, 20, 40, 80], REC = { calm: 0, g05: 0.05, g10: 0.10 };
  const setState = (n, m, rec, gust) => { pg.set('w02-n', n); pg.set('w02-demo', DEMOS.indexOf(m)); pg.set('w02-rec', rec); pg.set('w02-gust', gust); pg.drain(); };
  const probe = (s, tag, slope) => {
    eqd('w02-succ', s.succ, 1, tag + ' success'); eqd('w02-copy', s.held.err, 1, tag + ' held-out copy error'); eqd('w02-own', s.own.err, 1, tag + ' own-frame error');
    eqd('w02-beyond', s.beyond.own, 1, tag + ' share beyond one bandwidth'); eqd('w02-pullx', s.exp.bins[1].pull, 1, tag + ' expert pull-back'); eqd('w02-pullc', s.own.bins[1].pull, 1, tag + ' clone pull-back');
    eqd('w02-C', s.C, 1, tag + ' lost steps'); eqd('w02-haz', s.h * 1000, 2, tag + ' hazard'); eqd('w02-T', s.T, 0, tag + ' steps allowed');
    if (slope !== undefined) eqd('w02-slope', slope, 2, tag + ' exponent across courses');
  };
  setState(5, 20, 'calm', 0.05); probe(d5, 'default', F.slope_courses);
  setState(3, 20, 'calm', 0.05); probe(setting(3, 20, 0, 0.05, true), 'n=3');
  setState(6, 20, 'calm', 0.05); probe(setting(6, 20, 0, 0.05, true), 'n=6');
  setState(5, 80, 'calm', 0.05); probe(m80, '80 demos');
  setState(5, 5, 'calm', 0.05); probe(m5, '5 demos');
  setState(5, 20, 'g05', 0.05); probe(r05, 'recorded under 0.05');
  setState(5, 20, 'g10', 0.05); probe(r10, 'recorded under 0.10');
  setState(5, 20, 'calm', 0); probe(g0, 'gust 0');
  setState(5, 20, 'calm', 0.08); probe(g8, 'gust 0.08');
}

console.log(JSON.stringify({ facts: F }));
process.exit(bad ? 1 : 0);
