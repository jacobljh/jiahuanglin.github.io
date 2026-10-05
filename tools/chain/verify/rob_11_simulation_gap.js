#!/usr/bin/env node
'use strict';
/* Oracle for robot_model_training lesson 11 (simulation: unlimited data, wrong physics).
 * Everything the lesson quotes is re-derived with code written separately from the page's engine (gap_lab.js): the plant from its equations, a nearest-demo table with its own
 * grid, its own rollout loop, the simulator-side training loop, least squares by explicit convolution, the Cramer-Rao bound from the Fisher information, the Wilson interval.
 * Only the world's primitives (arm, expert, collision, path, the random generator) come from bench.js.  The page's widget is then driven into the states the prose describes
 * and what it prints must equal the independent number.  Last stdout line: {"facts": {...}}.
 * ORACLE_CACHE=<file> keeps the slow experiments between runs while the lesson is being written; unset, everything is computed from scratch. */
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '../../../all_lessons');
const dir = fs.existsSync(path.join(root, 'robot_model_training_new')) ? 'robot_model_training_new' : 'robot_model_training';
const BN = require(path.join(root, dir, 'bench.js'));
const GL = require(path.join(root, dir, 'gap_lab.js'));
const { loadPage } = require('../dom_probe.js');

let bad = 0;
const fail = (m) => { bad++; console.error('FAIL ' + m); };
const check = (c, m) => { if (!c) fail(m); };
const F = {};
const CACHE = process.env.ORACLE_CACHE, store = CACHE && fs.existsSync(CACHE) ? JSON.parse(fs.readFileSync(CACHE, 'utf8')) : {};
const memo = (key, fn) => { if (store[key] === undefined) { store[key] = fn(); if (CACHE) fs.writeFileSync(CACHE, JSON.stringify(store)); } return store[key]; };
const r1 = (x) => +x.toFixed(1), r2 = (x) => +x.toFixed(2), r3 = (x) => +x.toFixed(3);
const pc = (x) => +(100 * x).toFixed(1);

/* ───── the plant, from its equations:  v <- v + k (g u[t-d] - v),  k = dt / (tau + dt),  q <- q + dt (v + gust) ───── */
const DT = 0.05, JIT = 0.01, GUST = 0.05, HB = 0.02;
function Plant(P) {
  this.g = P.gain === undefined ? 1 : P.gain; this.tau = P.lag || 0; this.d = P.delay || 0; this.k = DT / (this.tau + DT);
  this.v = [0, 0]; this.q = null; this.hist = [];
}
Plant.prototype.reset = function (q0) { this.q = [q0[0], q0[1]]; this.v = [0, 0]; this.hist = []; for (let i = 0; i < this.d; i++) this.hist.push([0, 0]); };
Plant.prototype.step = function (u, rng) {
  this.hist.push(u); const ua = this.hist.shift();
  for (let j = 0; j < 2; j++) {
    const c = Math.max(-1.5, Math.min(1.5, ua[j])) * this.g;
    this.v[j] = this.tau > 0 ? this.v[j] + this.k * (c - this.v[j]) : c;
    this.q[j] += DT * (this.v[j] + GUST * BN.randn(rng));
  }
};
function run(w, policy, rng, P, T) {                    // one rollout from a jittered start; same random-number order as the Bench
  const pl = new Plant(P), dy = JIT * BN.randn(rng); pl.reset(BN.slalom.startQ(w, dy));
  const S = [], A = [], xe = BN.slalom.xEnd(w); let coll = false, done = false, steps = T;
  for (let t = 0; t < T; t++) {
    const q = pl.q, p = BN.arm.fk(q, w.body); S.push([q[0], q[1]]);
    if (BN.slalom.collide(w, p)) { coll = true; steps = t; break; }
    if (p[0] > xe - 0.02) { done = true; steps = t; break; }
    const u = policy([q[0], q[1]]); A.push(u); pl.step(u, rng);
  }
  return { S, A, coll, done, steps };
}
/* the table of stored frames: a grid of 0.05 rad cells, kernel exp(-e/2) with e the squared distance in bandwidths, nothing beyond e = 9, the nearest frame when nothing is in reach */
function Table() { this.X = []; this.Y = []; this.cells = new Map(); this.far = 0; this.calls = 0; }
const CELL = 0.05, key = (i, j) => (i + 4096) * 8192 + (j + 4096);
Table.prototype.add = function (x, y) {
  const id = this.X.length; this.X.push(x); this.Y.push(y);
  const k = key(Math.floor(x[0] / CELL), Math.floor(x[1] / CELL)); let a = this.cells.get(k); if (!a) this.cells.set(k, a = []); a.push(id);
};
Table.prototype.predict = function (q) {
  this.calls++; const R = 3 * HB; let tot = 0, a0 = 0, a1 = 0;
  for (let i = Math.floor((q[0] - R) / CELL); i <= Math.floor((q[0] + R) / CELL); i++) for (let j = Math.floor((q[1] - R) / CELL); j <= Math.floor((q[1] + R) / CELL); j++) {
    const a = this.cells.get(key(i, j)); if (!a) continue;
    for (let m = 0; m < a.length; m++) {
      const x = this.X[a[m]], e = ((x[0] - q[0]) / HB) ** 2 + ((x[1] - q[1]) / HB) ** 2;
      if (e > 9) continue; const wt = Math.exp(-0.5 * e); tot += wt; a0 += wt * this.Y[a[m]][0]; a1 += wt * this.Y[a[m]][1];
    }
  }
  if (tot < 1e-12) {
    this.far++; let bi = 0, bd = Infinity;
    for (let m = 0; m < this.X.length; m++) { const e = ((this.X[m][0] - q[0]) / HB) ** 2 + ((this.X[m][1] - q[1]) / HB) ** 2; if (e < bd) { bd = e; bi = m; } }
    return this.Y[bi].slice();
  }
  return [a0 / tot, a1 / tot];
};
const expertAt = (w, pace) => { const k = (pace || 15) / 15; return pace ? (q) => { const u = BN.slalom.expertAct(w, q); return [u[0] * k, u[1] * k]; } : (q) => BN.slalom.expertAct(w, q); };
const W5 = BN.slalom.world(5), T0 = BN.slalom.horizon(W5);
/* train in the simulator: range {gain, delay, lo, hi}; demos expert runs, then rounds x per runs of the clone relabelled by the expert; one random stream */
function trainClone(w, rg, seed, b) {
  b = b || { demos: 20, rounds: 4, per: 5 };
  const rng = BN.rng(seed), tab = new Table(), T = BN.slalom.horizon(w), ex = expertAt(w);
  const draw = () => ({ gain: rg.gain, delay: rg.delay || 0, lag: rg.lo + (rg.hi - rg.lo) * rng() });
  const put = (ro, relabel) => { for (let t = 0; t < ro.S.length; t++) if (relabel || t < ro.A.length) tab.add(ro.S[t], relabel ? ex(ro.S[t]) : ro.A[t]); };
  for (let i = 0; i < b.demos; i++) { const P = draw(); put(run(w, ex, rng, P, T), false); }
  for (let r = 0; r < b.rounds; r++) for (let i = 0; i < b.per; i++) { const P = draw(); put(run(w, (q) => tab.predict(q), rng, P, T), true); }
  return tab;
}
function wilson(k, n) { const z = 1.96, p = k / n, d = 1 + z * z / n, c = (p + z * z / (2 * n)) / d, h = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d; return [Math.max(0, c - h), Math.min(1, c + h)]; }
function score(w, policy, P, N, seed, T) {            // N runs on plant P: success, collision, timeout (shares), own-frame error, mean steps of the successes
  const rng = BN.rng(seed), TT = T || BN.slalom.horizon(w); let ok = 0, co = 0, se = 0, ss = 0, st = 0;
  for (let k = 0; k < N; k++) {
    const ro = run(w, policy, rng, P, TT); if (ro.done) { ok++; st += ro.steps; } if (ro.coll) co++;
    for (let t = 0; t < ro.A.length; t++) { const a = BN.slalom.expertAct(w, ro.S[t]); se += (ro.A[t][0] - a[0]) ** 2 + (ro.A[t][1] - a[1]) ** 2; ss += a[0] * a[0] + a[1] * a[1]; }
  }
  return { succ: ok / N, coll: co / N, tout: 1 - (ok + co) / N, own: Math.sqrt(se / ss), steps: ok ? st / ok : 0, ci: wilson(ok, N) };
}
const NOM = { gain: 1, delay: 0, lo: 0, hi: 0 };
const around = (centre, wd) => ({ gain: centre.gain, delay: centre.delay || 0, lo: Math.max(0, centre.lag - wd), hi: centre.lag + wd });
const clonePolicy = (tab) => (q) => tab.predict(q);
const N200 = 200, SEED = 5;

/* ───── least squares by explicit convolution, and the Cramer-Rao bound ───── */
function probeRun(P, rng) {
  const pl = new Plant({ gain: P.gain, lag: P.lag, delay: P.delay || 0 }); pl.reset([0.3, 1.2]); const U = [], Y = []; let u = [0, 0];
  for (let t = 0; t < 60; t++) {
    if (t % 5 === 0) u = [0.15 * (2 * rng() - 1), 0.15 * (2 * rng() - 1)];
    const q0 = [pl.q[0], pl.q[1]]; pl.step(u, rng); U.push(u); Y.push([(pl.q[0] - q0[0]) / DT, (pl.q[1] - q0[1]) / DT]);
  }
  return { U, Y };
}
function respConv(U, j, tau, d) {                       // f_t = sum_{s<=t} k (1-k)^(t-s) c_s with c_s the clipped command d steps earlier (v starts at rest)
  const L = U.length, f = new Array(L).fill(0), c = U.map((u, s) => (s >= d ? Math.max(-1.5, Math.min(1.5, U[s - d][j])) : 0));
  if (tau <= 0) return c;
  const k = DT / (tau + DT), r = 1 - k;
  for (let t = 0; t < L; t++) { let a = 0, pw = 1; for (let s = t; s >= 0; s--) { a += k * pw * c[s]; pw *= r; } f[t] = a; }
  return f;
}
function lsFit(runs, delays) {                          // minimise over (tau, d) the squared error of g f against y, g in closed form; same grid as the page: 0 to 0.6 s in 5 ms
  let best = null;
  for (const d of delays) for (let ti = 0; ti <= 120; ti++) {
    const tau = ti * 0.005; let fy = 0, ff = 0, yy = 0;
    for (const r of runs) for (let j = 0; j < 2; j++) { const f = respConv(r.U, j, tau, d); for (let t = 0; t < f.length; t++) { fy += f[t] * r.Y[t][j]; ff += f[t] * f[t]; yy += r.Y[t][j] ** 2; } }
    const g = fy / ff, sse = yy - g * fy; if (!best || sse < best.sse) best = { gain: g, lag: tau, delay: d, sse };
  }
  return best;
}
function calibrate(n, P, seed, delays) {
  if (n <= 0) return { gain: 1, lag: 0, delay: 0 };
  const rng = BN.rng(seed), runs = []; for (let i = 0; i < n; i++) runs.push(probeRun(P, rng));
  return lsFit(runs, delays || [0]);
}
function crlbLag(n, P, seed) {                          // Cramer-Rao variance of the lag for n probe runs of the realised commands: Fisher information of (gain, lag), noise 0.05 rad/s
  const rng = BN.rng(seed); let a = 0, b = 0, c = 0; const e = 1e-5;
  for (let i = 0; i < n; i++) {
    const r = probeRun(P, rng);
    for (let j = 0; j < 2; j++) {
      const f = respConv(r.U, j, P.lag, 0), fp = respConv(r.U, j, P.lag + e, 0), fm = respConv(r.U, j, Math.max(0, P.lag - e), 0), dd = P.lag - e < 0 ? e : 2 * e;
      for (let t = 0; t < f.length; t++) { const dg = f[t], dt = P.gain * (fp[t] - fm[t]) / dd; a += dg * dg; b += dg * dt; c += dt * dt; }
    }
  }
  const s2 = GUST * GUST, det = (a * c - b * b) / (s2 * s2);
  return { varLag: (a / s2) / det, varGain: (c / s2) / det };
}
const sd = (xs) => { const m = xs.reduce((s, x) => s + x, 0) / xs.length; return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1)); };
const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;

module.exports = { run, Plant, Table, trainClone, score, calibrate, lsFit, probeRun, respConv, crlbLag, wilson, W5, T0, NOM, around, clonePolicy, expertAt };
if (require.main !== module) return;
const t00 = Date.now(); const lap = (m) => console.error(m + ' (' + ((Date.now() - t00) / 1000).toFixed(0) + ' s)');

/* ═════════════ EXPERIMENTS ═════════════ */
/* ── 1. the plant: a lag of 0.2 s is 4 steps; the unit-gain velocity after n steps is 1 - (tau/(tau+dt))^n ── */
{
  const pl = new Plant({ lag: 0.2 }); pl.reset([0, 0]); const rng = BN.rng(1); let v4 = 0;
  const Pn = new Plant({ lag: 0.2 }); Pn.reset([0, 0]);
  for (let t = 0; t < 4; t++) { Pn.hist.push([1, 1]); Pn.hist.shift(); const c = 1; Pn.v[0] = Pn.v[0] + Pn.k * (c - Pn.v[0]); v4 = Pn.v[0]; }
  F.lag_steps = 0.2 / DT; F.lag_frac4 = pc(1 - Math.pow(0.2 / (0.2 + DT), 4));
  check(Math.abs(v4 - (1 - Math.pow(0.2 / (0.2 + DT), 4))) < 1e-12, 'closed form of the lag step response');
  void pl; void rng;
}

/* ── 2. the gap: a clone trained in the plain simulator, on robots that differ in one number; the expert on the same robots ── */
const nomTab = trainClone(W5, NOM, 1);
F.frames40 = nomTab.X.length;
const gapRows = [['lag05', { lag: 0.05 }], ['lag10', { lag: 0.1 }], ['lag20', { lag: 0.2 }], ['lag30', { lag: 0.3 }], ['dly1', { delay: 1 }], ['dly2', { delay: 2 }], ['dly4', { delay: 4 }], ['dly6', { delay: 6 }],
  ['gain70', { gain: 0.7 }], ['gain85', { gain: 0.85 }], ['gain150', { gain: 1.5 }]];
const gapNom = memo('gapNom', () => score(W5, clonePolicy(nomTab), {}, N200, SEED));
F.g_nom = pc(gapNom.succ); F.own_nom = pc(gapNom.own);
const gapExpNom = memo('gapExpNom', () => score(W5, expertAt(W5), {}, N200, SEED)); F.e_nom = pc(gapExpNom.succ);
for (const [name, P] of gapRows) {
  const c = memo('gap_' + name, () => score(W5, clonePolicy(nomTab), P, N200, SEED)), e = memo('gapE_' + name, () => score(W5, expertAt(W5), P, N200, SEED));
  F['g_' + name] = pc(c.succ); F['e_' + name] = pc(e.succ); F['gc_' + name] = pc(c.coll); F['gt_' + name] = pc(c.tout);
  if (name === 'lag20') { F.own_lag20 = pc(c.own); }
}
lap('gap table');
{ // the own-frame error and the share of steps with no stored frame in reach, nominal against lag 0.2
  const t1 = Table.prototype; void t1;
  const far = (P) => { nomTab.far = 0; nomTab.calls = 0; score(W5, clonePolicy(nomTab), P, 100, SEED); return nomTab.far / nomTab.calls; };
  F.far_nom = pc(far({})); F.far_lag20 = pc(far({ lag: 0.2 }));
}
{ // not a seed accident: six training seeds
  const lag10 = [], lag20 = [];
  for (let s = 1; s <= 6; s++) { const tab = trainClone(W5, NOM, s); lag10.push(score(W5, clonePolicy(tab), { lag: 0.1 }, N200, SEED).succ); lag20.push(score(W5, clonePolicy(tab), { lag: 0.2 }, N200, SEED).succ); }
  F.seed_lag10_min = pc(Math.min(...lag10)); F.seed_lag10_max = pc(Math.max(...lag10)); F.seed_lag20_min = pc(Math.min(...lag20)); F.seed_lag20_max = pc(Math.max(...lag20));
}
lap('seeds');

/* ── 3. more simulated data does not close it: 40, 160 and 640 simulated runs, three training seeds each, mean success ── */
for (const [tag, b] of [['40', undefined], ['160', { demos: 80, rounds: 4, per: 20 }], ['320', { demos: 160, rounds: 4, per: 40 }]]) {
  const acc = { nom: [], l10: [], l20: [] };
  for (let sd0 = 1; sd0 <= 3; sd0++) {
    const tab = trainClone(W5, NOM, sd0, b); if (sd0 === 1) F['frames' + tag] = tab.X.length;
    for (const [nm, P] of [['nom', {}], ['l10', { lag: 0.1 }], ['l20', { lag: 0.2 }]]) acc[nm].push(memo('md' + tag + nm + sd0, () => score(W5, clonePolicy(tab), P, N200, SEED).succ));
  }
  for (const nm of ['nom', 'l10', 'l20']) F['md' + tag + '_' + nm] = pc(mean(acc[nm]));
}
lap('more data');

/* ── 4. draw the plant at random: widths around the plain simulator (lag range [0, w]), real lag 0 .. 0.4, gain 1 ── */
const RW = [0, 0.1, 0.2, 0.3, 0.45], RL = [0, 0.1, 0.2, 0.3, 0.4];
for (const wd of RW) {
  const tab = trainClone(W5, around({ gain: 1, lag: 0 }, wd), 1);
  for (const l of RL) F['r' + Math.round(wd * 100) + '_' + Math.round(l * 100)] = pc(memo('r' + wd + '_' + l, () => score(W5, clonePolicy(tab), { lag: l }, N200, SEED).succ));
}
lap('randomise');

/* ── 5. what the width costs ── */
{ // precision where the simulator was exact: robot lag 0, gain 0.9, centre exact; 3 training seeds; 40 runs and 160 runs; copy error on fresh expert frames
  const real = { gain: 0.9, lag: 0 };
  for (const [tag, b] of [['40', undefined], ['160', { demos: 80, rounds: 4, per: 20 }]]) for (const wd of [0, 0.15, 0.3, 0.6]) {
    const vals = [], ces = [];
    for (let s = 1; s <= 3; s++) {
      const tab = trainClone(W5, around(real, wd), s, b), sc = memo('pr' + tag + '_' + wd + '_' + s, () => score(W5, clonePolicy(tab), real, N200, SEED));
      vals.push(sc.succ);
      if (tag === '40') { // copy error on 10 fresh expert runs (the lesson-1 error), same plant
        const rng = BN.rng(99), ex = expertAt(W5); let se = 0, ss = 0;
        for (let k = 0; k < 10; k++) { const ro = run(W5, ex, rng, real, T0); for (let t = 0; t < ro.A.length; t++) { const p = tab.predict(ro.S[t]); se += (p[0] - ro.A[t][0]) ** 2 + (p[1] - ro.A[t][1]) ** 2; ss += ro.A[t][0] ** 2 + ro.A[t][1] ** 2; } }
        ces.push(Math.sqrt(se / ss));
      }
    }
    F['pr' + tag + '_w' + Math.round(wd * 100)] = pc(mean(vals)); if (tag === '40') F['ce_w' + Math.round(wd * 100)] = pc(mean(ces));
  }
}
F.loss40 = r1(F.pr40_w0 - F.pr40_w60); F.loss160 = r1(F.pr160_w0 - F.pr160_w60);
F.md_gain10 = r1(F.md320_l10 - F.md40_l10); F.md_gain20 = r1(F.md320_l20 - F.md40_l20);
lap('price');
{ // the expert's own limit (gain 1, the clock of lessons 1 to 10)
  const lims = [0.3, 0.35, 0.4, 0.5]; let limit = 0;
  for (const l of lims) F['ex_lag' + Math.round(l * 100)] = pc(memo('exl' + l, () => score(W5, expertAt(W5), { lag: l }, N200, SEED).succ));
  for (const l of [0.1, 0.2, 0.25, 0.3, 0.35, 0.4]) if (memo('exl' + l, () => score(W5, expertAt(W5), { lag: l }, N200, SEED).succ) >= 0.95) limit = l;
  F.ex_limit = limit;
  // the robot at lag 0.35, exact centre, every width: nothing helps
  const v = []; for (const wd of [0, 0.1, 0.2, 0.3, 0.45]) { const real = { gain: 1, lag: 0.35 }, tab = trainClone(W5, around(real, wd), 1); v.push(memo('lim35_' + wd, () => score(W5, clonePolicy(tab), real, N200, SEED).succ)); }
  F.lim35_min = pc(Math.min(...v)); F.lim35_max = pc(Math.max(...v));
}
{ // caution: the expert at slower paces with twice the time (372 steps), and the slowest pace that fits the lessons' clock
  const T2 = 2 * 186; F.T2 = T2; F.T0 = T0;
  for (const pace of [15, 12, 10]) {
    for (const l of [0.4, 0.5]) F['pace' + pace + '_' + Math.round(l * 100)] = pc(memo('pace' + pace + '_' + l, () => score(W5, expertAt(W5, pace), { lag: l }, N200, SEED, T2).succ));
    F['time' + pace] = r2(15 / pace);
  }
  let minPace = 15; for (let p = 15; p >= 10; p -= 0.25) { if (score(W5, expertAt(W5, p), {}, 100, SEED, T0).succ >= 0.95) minPace = p; else break; }
  F.pace_min_T0 = minPace; F.pace_min_lag20 = pc(memo('pml20', () => score(W5, expertAt(W5, minPace), { lag: 0.2 }, 100, SEED, T0).succ));
  F.pace_steps12 = r1(memo('steps12', () => score(W5, expertAt(W5, 12), {}, 100, SEED, T2).steps));
  F.pace_steps15 = r1(memo('steps15', () => score(W5, expertAt(W5), {}, 100, SEED, T2).steps));
}
lap('caution');

/* ── 6. measure the robot: the scatter of the fit against the Cramer-Rao bound, the 1/sqrt(n) law, a delay ── */
{
  const real = { gain: 0.9, lag: 0.25 }; const ns = [1, 3, 10, 30], sds = [];
  for (const n of ns) {
    const res = memo('cal600_' + n, () => { const lags = [], gains = []; for (let k = 0; k < 600; k++) { const c = calibrate(n, real, 7000 + k); lags.push(c.lag); gains.push(c.gain); } return { lags, gains }; });
    const err = res.lags.map((l) => Math.abs(l - 0.25)).sort((a, b) => a - b);
    F['sd' + n] = r3(sd(res.lags)); F['gsd' + n] = r3(sd(res.gains)); F['p90_' + n] = r3(err[539]); F['bias' + n] = r3(mean(res.lags) - 0.25);
    const cr = memo('cr600_' + n, () => { let sv = 0; for (let k = 0; k < 600; k++) sv += crlbLag(n, real, 7000 + k).varLag; return Math.sqrt(sv / 600); });
    F['crlb' + n] = r3(cr); F['ratio' + n] = r2(sd(res.lags) / cr); sds.push(sd(res.lags));
  }
  const sl = BN.stats.logslope(ns, sds); F.slope = r2(sl.slope);
  F.ratio_dev = Math.round(100 * Math.max(...ns.map((n) => Math.abs(F['ratio' + n] - 1))));
  F.probe_s = 60 * DT; F.probe_samples = 60 * 2; F.noise_sd = GUST;
  F.n_for_02 = Math.ceil(Math.pow(F.sd1 / 0.02, 2));
  // a delay of 3 steps and no lag: the same fit with a delay grid, n = 3
  const dl = memo('delay3', () => { let ok = 0; const lat = []; for (let k = 0; k < 100; k++) { const c = calibrate(3, { gain: 0.9, lag: 0, delay: 3 }, 8000 + k, [0, 1, 2, 3, 4, 5, 6]); if (c.delay === 3) ok++; lat.push(c.lag + c.delay * DT); } return { ok, lat }; });
  F.delay_ok = dl.ok; F.delay_lat_sd = r3(sd(dl.lat)); F.delay_lat_mean = r3(mean(dl.lat));
}
lap('calibration');

/* ── 7. the fleet: robots with lag 0, 0.1, 0.2, 0.25 s (gain 0.9), K = 5 repeated calibrations of n probe runs, seven widths, 100 runs per point ── */
const FLEET = GL.FLEET, WIDTHS = GL.WIDTHS, KCAL = GL.K, NPT = GL.NPOINT, TRUTH = (ri) => ({ gain: 0.9, lag: FLEET[ri] });
const curves = {};
function fleetCurve(n, ri) {                              // for each width: the K successes of the clones trained around the K calibrations
  const id = n + '_' + ri; if (curves[id]) return curves[id];
  const out = memo('fleet' + id, () => {
    const K = n ? KCAL : 1, cals = [], rows = [];
    for (let k = 0; k < K; k++) cals.push(calibrate(n, TRUTH(ri), 1 + k));
    for (const wd of WIDTHS) rows.push(cals.map((c) => score(W5, clonePolicy(trainClone(W5, around(c, wd), 1)), TRUTH(ri), NPT, SEED).succ));
    return { cals, rows };
  });
  out.mean = out.rows.map((r) => mean(r)); out.min = out.rows.map((r) => Math.min(...r));
  out.best = out.mean.reduce((bi, v, i) => (v > out.mean[bi] + 1e-12 ? i : bi), 0);
  return (curves[id] = out);
}
const widx = (wd) => WIDTHS.indexOf(wd);
const wkey = (wd) => Math.round(wd * 100);
const knee = (c) => { const top = Math.max(...c.mean); return c.mean.findIndex((v) => v >= top - 0.02 - 1e-12); };     // the narrowest width within 2 points of the best
GL.CALN.forEach((n) => {
  const c = fleetCurve(n, 2), tag = 'f02_n' + n;
  WIDTHS.forEach((wd, wi) => { F[tag + '_m' + wkey(wd)] = pc(c.mean[wi]); F[tag + '_lo' + wkey(wd)] = pc(c.min[wi]); });
  F[tag + '_best'] = WIDTHS[c.best]; F[tag + '_bestv'] = pc(c.mean[c.best]); F[tag + '_knee'] = WIDTHS[knee(c)];
  F[tag + '_err'] = r3(c.cals.map((x) => Math.abs(x.lag - 0.2)).sort((a, b) => a - b)[Math.floor(c.cals.length / 2)]);
});
for (const [n, ri] of [[10, 0], [10, 3], [0, 1]]) {
  const c = fleetCurve(n, ri), tag = 'f' + String(Math.round(FLEET[ri] * 100)).padStart(2, '0') + '_n' + n;
  WIDTHS.forEach((wd, wi) => { F[tag + '_m' + wkey(wd)] = pc(c.mean[wi]); });
  F[tag + '_best'] = WIDTHS[c.best]; F[tag + '_bestv'] = pc(c.mean[c.best]); F[tag + '_knee'] = WIDTHS[knee(c)];
}
lap('fleet');

/* ── 8. what a score alone costs: attempts to tell two candidates apart (two-proportion test, 5 % two-sided, 80 % power), checked by simulating the test ── */
function attempts(p1, p2) { const za = 1.96, zb = 0.8416, pb = (p1 + p2) / 2; return Math.ceil(2 * (za + zb) ** 2 * pb * (1 - pb) / (p1 - p2) ** 2); }   // n = 2 (1.96 + 0.8416)^2 pbar (1 - pbar) / delta^2, the rule lesson 15 derives
function power(p1, p2, m, trials, seed) {
  const rng = BN.rng(seed); let hit = 0;
  for (let t = 0; t < trials; t++) {
    let a = 0, b = 0; for (let i = 0; i < m; i++) { if (rng() < p1) a++; if (rng() < p2) b++; }
    const pa = a / m, pb = b / m, pp = (a + b) / (2 * m), se = Math.sqrt(2 * pp * (1 - pp) / m);
    if (se > 0 && Math.abs(pb - pa) / se > 1.96 && (pa > pb) === (p1 > p2)) hit++;
  }
  return hit / trials;
}
{
  const c3 = fleetCurve(3, 2), pLo = c3.mean[widx(0)], pHi = c3.mean[widx(0.15)];
  F.att_gap = attempts(pHi, pLo); F.att_gap_hours = r1(F.att_gap * 30 / 3600); F.pow_gap = r2(power(pHi, pLo, F.att_gap, 4000, 11));
  F.att_3pt = attempts(0.96, 0.93); F.att_3pt_hours = r1(F.att_3pt * 30 / 3600); F.pow_3pt = r2(power(0.96, 0.93, F.att_3pt, 4000, 12));
  F.pow_gap_at20 = r2(power(pHi, pLo, 20, 4000, 13));
}
lap('score');

/* ───── the engine of the page computes what this file computes ───── */
{
  const w = GL.world();
  for (const [n, ri, k, wi] of [[3, 2, 0, 0], [3, 2, 4, 3], [10, 0, 2, 5], [0, 2, 0, 6], [1, 2, 1, 4]]) {
    const cell = GL.cell(n, ri, k, wi), c = fleetCurve(n, ri);
    check(Math.abs(cell.succ - c.rows[wi][n ? k : 0]) < 1e-12, `engine and oracle agree on the clone of calibration ${k} (n = ${n}, robot ${FLEET[ri]}, width ${WIDTHS[wi]}): ${cell.succ} vs ${c.rows[wi][n ? k : 0]}`);
    check(cell.cal.lag === c.cals[n ? k : 0].lag && Math.abs(cell.cal.gain - c.cals[n ? k : 0].gain) < 1e-9, `engine and oracle fit the same lag and gain (n = ${n}, robot ${FLEET[ri]}, draw ${k})`);
  }
  const eng = GL.evaluate(w, GL.train(w, GL.range(GL.NOMINAL, 0)), { lag: 0.1 }, 200, 5).succ;
  check(Math.abs(eng * 100 - F.g_lag10) < 1e-9, 'engine and oracle agree on the plain clone at lag 0.1');
}
/* the scatter the widget prints: 20 repeated calibrations on robot 0.2, seeds 500 to 519 */
for (const n of [1, 3, 10]) F['sd20_n' + n] = r3(sd(Array.from({ length: 20 }, (_, k) => calibrate(n, TRUTH(2), 500 + k).lag)));

/* ───── the claims of the prose ───── */
check(F.e_nom === 100 && F.e_lag05 >= 99 && F.e_lag10 >= 99 && F.e_lag20 >= 99 && F.e_dly2 >= 99 && F.e_dly4 >= 99 && F.e_dly6 >= 99 && F.e_gain85 >= 99, 'the expert passes every run up to lag 0.2, delay 6 and gain 0.85');
check(F.e_lag30 >= 95, 'the expert still passes 95 % at lag 0.3');
check(F.g_lag10 < 60 && F.g_lag20 < 5 && F.g_dly2 < 60 && F.g_dly4 < 5, 'the clone has lost about half its runs at lag 0.1 / delay 2 and nearly all at 0.2 / 4');
check(F.g_lag05 < F.g_nom - 8, 'a lag of one step already costs the clone more than 8 points');
check(['lag05', 'lag10', 'lag20', 'lag30', 'dly1', 'dly2', 'dly4', 'dly6'].every((k) => F['gt_' + k] === 0), 'every failure at a lag or a delay is a collision');
check(F.g_gain150 >= F.g_nom && F.g_gain85 < F.g_nom - 5 && F.g_gain85 > 75 && F.gc_gain85 === 100 - F.g_gain85, 'gain 1.5 costs nothing, 0.85 a few points (all collisions)');
check(F.e_gain70 < 5 && F.g_gain70 < 5 && F.gt_gain70 >= 70, 'at gain 0.7 both fail, by the clock');
check(F.far_nom === 0 && F.far_lag20 > 5, 'no step of the clone is outside the table in its own simulator, and more than 5 % are at lag 0.2');
check(F.seed_lag10_min < 50 && F.seed_lag10_max > 70 && F.seed_lag20_max < 10, 'six training seeds: the gap is not a seed accident');
check(Math.abs(F.md320_nom - F.md40_nom) < 2 && F.md_gain10 > 0 && F.md_gain10 < 12 && F.md_gain20 < 6 && F.md320_l20 < 10, 'eight times the data moves the gap by a few points only');
check(F.r30_20 > 95 && F.r0_20 < 5 && F.r0_20 < F.r10_20 && F.r10_20 < F.r20_20 && F.r20_20 < F.r30_20, 'widening the range lifts the robot at lag 0.2 step by step');
check(F.r45_40 < 30 && Math.max(F.r0_40, F.r10_40, F.r20_40, F.r30_40, F.r45_40) === F.r45_40, 'no width rescues the robot at lag 0.4');
check(F.r30_0 < F.r0_0 - 8 && F.r20_10 > 95, 'widening costs the robot with no lag, and covers the robot at 0.1 s');
check(F.pr40_w0 > F.pr40_w15 && F.pr40_w15 > F.pr40_w30 && F.pr40_w30 > F.pr40_w60 && F.loss40 > 20, 'the exact robot loses more than 20 points as the range widens to 0.6 s');
check(F.pr160_w60 > F.pr40_w60 + 8 && F.loss160 < 0.55 * F.loss40 && F.loss160 > 5, 'four times the runs cut the loss to about half and do not remove it');
check(F.ce_w0 < F.ce_w15 && F.ce_w15 < F.ce_w30 && F.ce_w30 < F.ce_w60, 'the copy error on fresh expert frames rises with the width');
check(F.ex_lag30 >= 95 && F.ex_lag35 < 95 && F.ex_lag40 < 75 && F.ex_lag50 < 10, 'the expert fails beyond a lag of about 0.3 s on the lessons\' clock');
check(F.lim35_max < F.ex_lag35 - 5, 'no width brings the clone to the expert at a lag of 0.35 s');
check(F.pace12_50 > F.pace15_50 + 40 && F.pace10_50 > F.pace12_50 && F.pace12_40 > F.pace15_40 && F.pace10_40 > F.pace12_40, 'a slower expert passes more runs at long lags');
check(F.pace_min_T0 >= 11.5 && F.pace_min_T0 <= 13 && F.pace_min_lag20 < 95, 'at the lessons\' clock there is almost no room to slow down, and a lag uses it');
check(F.slope < -0.45 && F.slope > -0.7 && F.sd1 > F.sd3 && F.sd3 > F.sd10 && F.sd10 > F.sd30, 'the scatter of the fit falls roughly as 1/sqrt(n)');
check(F.ratio_dev <= 20 && Math.abs(F.bias1) < 0.005 && Math.abs(F.bias3) < 0.005 && Math.abs(F.bias10) < 0.005 && Math.abs(F.bias30) < 0.005, 'the fit is unbiased and within 20 % of the Cramer-Rao bound');
check(F.p90_1 > F.p90_3 && F.p90_3 > F.p90_10 && F.p90_10 > F.p90_30, 'the tail of the fit error shrinks with n');
check(F.delay_ok >= 95 && F.delay_lat_sd < 0.01, 'a delay of 3 steps is recovered');
check(F.n_for_02 === 13 && F.sd10 < 0.02, 'the checkpoint arithmetic');
check(F.f02_n0_m0 < 5 && F.f02_n0_m30 > 90 && F.f02_n0_knee === 0.3 && F.f02_n3_knee === 0.15 && F.f02_n10_knee === 0 && F.f02_n1_knee === 0.3, 'the knee falls with the probes: 0.3, 0.3, 0.15, 0');
check(F.f02_n3_m0 < F.f02_n3_m15 - 5 && F.f02_n3_m30 > 95 && F.f02_n10_m0 > 94 && F.f02_n1_lo0 < F.f02_n1_m0 - 20 && F.f02_n1_lo30 > 85, 'robot 0.2: the means and the worst calibration');
check(F.f00_n10_m0 > F.f00_n10_m30 + 10 && F.f25_n10_m30 > F.f25_n10_m0 + 5 && F.f10_n0_m0 < 60 && F.f10_n0_m10 > 95, 'robots 0, 0.25 and 0.1');
check(F.pow_gap > 0.75 && F.pow_gap < 0.87 && F.pow_3pt > 0.74 && F.pow_3pt < 0.86 && F.pow_gap_at20 < 0.3, 'the attempts needed to tell candidates apart give the stated power when simulated');

/* ───── the widget prints the same numbers ───── */
const html = path.join(root, dir, '11_simulation_gap.html');
if (fs.existsSync(html)) {
  const pg = loadPage(html);
  pg.problems.forEach((p) => fail('page problem: ' + p));
  const eq = (id, want, digits, what) => { const got = pg.num(id); if (!(Math.abs(got - want) <= 0.5 * Math.pow(10, -digits) + 1e-9)) fail(`${what}: widget #${id} prints ${got}, independent computation gives ${want}`); };
  const setState = (n, ri, wi) => { pg.set('w11-n', n); pg.set('w11-r', ri); pg.set('w11-w', wi); pg.drain(); };
  const probe = (n, ri, wi, tag) => {
    const c = fleetCurve(n, ri), wd = WIDTHS[wi], lag = FLEET[ri];
    setState(n, ri, wi);
    eq('w11-mean', 100 * c.mean[wi], 1, tag + ' mean'); eq('w11-min', 100 * c.min[wi], 1, tag + ' worst');
    eq('w11-cov', c.cals.filter((x) => Math.max(0, x.lag - wd) <= lag && lag <= x.lag + wd).length, 0, tag + ' ranges containing the lag');
    eq('w11-err', c.cals.map((x) => Math.abs(x.lag - lag)).sort((a, b) => a - b)[Math.floor(c.cals.length / 2)], 3, tag + ' fit error');
    eq('w11-zero', 100 * c.mean[0], 1, tag + ' mean at width 0'); eq('w11-knee', WIDTHS[knee(c)], 2, tag + ' knee'); eq('w11-best', 100 * c.mean[c.best], 1, tag + ' best mean');
    if (n) { const sd20 = sd(Array.from({ length: 20 }, (_, k) => calibrate(n, TRUTH(ri), 500 + k).lag)); eq('w11-sd', sd20, 3, tag + ' scatter of the fit'); }
    else check(/—/.test(pg.text('w11-sd')), tag + ': no scatter is printed when nothing was measured');
  };
  probe(3, 2, 3, 'default (robot 0.2, 3 probes, width 0.15)');
  probe(3, 2, 0, 'robot 0.2, 3 probes, width 0'); probe(3, 2, 5, 'robot 0.2, 3 probes, width 0.3');
  probe(0, 2, 0, 'robot 0.2, no probes, width 0'); probe(0, 2, 5, 'robot 0.2, no probes, width 0.3');
  probe(1, 2, 0, 'robot 0.2, 1 probe, width 0'); probe(1, 2, 5, 'robot 0.2, 1 probe, width 0.3');
  probe(10, 2, 0, 'robot 0.2, 10 probes, width 0');
  probe(10, 0, 0, 'robot 0, 10 probes, width 0'); probe(10, 0, 5, 'robot 0, 10 probes, width 0.3');
  probe(0, 1, 0, 'robot 0.1, no probes, width 0'); probe(0, 1, 2, 'robot 0.1, no probes, width 0.1');
  probe(10, 3, 0, 'robot 0.25, 10 probes, width 0'); probe(10, 3, 5, 'robot 0.25, 10 probes, width 0.3');
  for (const wi of [0, 6]) { setState(3, 2, wi); check(/±/.test(pg.text('w11-w-v')), 'the width label is printed'); }
  setState(3, 2, 0); const t0 = pg.text('w11-mean'); setState(3, 2, 6); check(pg.text('w11-mean') !== t0, 'the first slider changes what the reader sees');
}

console.error('done');
fs.writeFileSync(process.env.ORACLE_FACTS || '/dev/null', JSON.stringify(F));
console.log(JSON.stringify({ facts: F }));
process.exit(bad ? 1 : 0);
