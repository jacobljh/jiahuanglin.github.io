#!/usr/bin/env node
'use strict';
/* Oracle for robot_model_training lesson 01 (behaviour cloning).
 * Re-derives every number the lesson quotes with code written separately from the widget's path: a brute-force kernel regressor (no grid hashing),
 * its own rollout loop and plant, its own Wilson interval.  Only the world's primitives (arm, expert, collision, path) come from bench.js.
 * Then it drives the page's widget and checks that what the widget prints is what the independent computation gives.  Last stdout line: {"facts": {...}}. */
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
const H = 0.02, DT = 0.05, JIT = 0.01, NROLL = 200, NEXP = 100;
function gaussStep(q, u, noise, rng) {                 // the plant: q += dt (u + noise * N(0,1)), command clipped at 1.5 rad/s
  const c = [Math.max(-1.5, Math.min(1.5, u[0])), Math.max(-1.5, Math.min(1.5, u[1]))];
  const n0 = noise ? noise * BN.randn(rng) : 0, n1 = noise ? noise * BN.randn(rng) : 0;
  q[0] += DT * (c[0] + n0); q[1] += DT * (c[1] + n1);
}
function run(w, pi, rng, noise, T) {                    // one rollout; returns {S, A, coll, done}
  const dy = JIT * BN.randn(rng), q = BN.slalom.startQ(w, dy).slice(), S = [], A = [], xe = BN.slalom.xEnd(w);
  let coll = false, done = false;
  for (let t = 0; t < T; t++) {
    const p = BN.arm.fk(q, w.body); S.push(q.slice());
    if (BN.slalom.collide(w, p)) { coll = true; break; }
    if (p[0] > xe - 0.02) { done = true; break; }
    const u = pi(q); A.push(u); gaussStep(q, u, noise, rng);
  }
  return { S, A, coll, done };
}
function demonstrations(w, m, noise) {                  // m expert runs from jittered starts, one shared random stream
  const rng = BN.rng(1), X = [], Y = [];
  for (let k = 0; k < m; k++) { const r = run(w, (q) => BN.slalom.expertAct(w, q), rng, noise, BN.slalom.horizon(w)); for (let t = 0; t < r.A.length; t++) { X.push(r.S[t]); Y.push(r.A[t]); } }
  return { X, Y };
}
function kernelPolicy(D) {                              // brute force: weight every stored frame; zero weight beyond 3 bandwidths
  return (q) => {
    let sw = 0, a0 = 0, a1 = 0, best = Infinity, bi = 0;
    for (let i = 0; i < D.X.length; i++) {
      const e = ((D.X[i][0] - q[0]) / H) ** 2 + ((D.X[i][1] - q[1]) / H) ** 2;
      if (e < best) { best = e; bi = i; }
      if (e <= 9) { const w = Math.exp(-0.5 * e); sw += w; a0 += w * D.Y[i][0]; a1 += w * D.Y[i][1]; }
    }
    return sw < 1e-12 ? D.Y[bi].slice() : [a0 / sw, a1 / sw];
  };
}
function wilson(k, n) { const z = 1.96, p = k / n, d = 1 + z * z / n, c = (p + z * z / (2 * n)) / d, h = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d; return [Math.max(0, c - h), Math.min(1, c + h)]; }
function experiment(n, m, cond, noise) {                // cond: 0 = calm demonstrations, 1 = demonstrations under the deployment noise
  const w = BN.slalom.world(n), T = BN.slalom.horizon(w), D = demonstrations(w, m, cond ? noise : 0), pi = kernelPolicy(D);
  // copy error on 10 fresh expert runs recorded the same way
  const rv = BN.rng(99); let se = 0, ss = 0;
  for (let k = 0; k < 10; k++) { const r = run(w, (q) => BN.slalom.expertAct(w, q), rv, cond ? noise : 0, T); for (let t = 0; t < r.A.length; t++) { const p = pi(r.S[t]); se += (p[0] - r.A[t][0]) ** 2 + (p[1] - r.A[t][1]) ** 2; ss += r.A[t][0] ** 2 + r.A[t][1] ** 2; } }
  const re = BN.rng(5); let ok = 0, co = 0, oe = 0, os = 0;
  for (let k = 0; k < NROLL; k++) {
    const r = run(w, pi, re, noise, T); if (r.done) ok++; if (r.coll) co++;
    for (let t = 0; t < r.A.length; t++) { const a = BN.slalom.expertAct(w, r.S[t]); oe += (r.A[t][0] - a[0]) ** 2 + (r.A[t][1] - a[1]) ** 2; os += a[0] ** 2 + a[1] ** 2; }
  }
  const rx = BN.rng(5); let okx = 0;
  for (let k = 0; k < NEXP; k++) { const r = run(w, (q) => BN.slalom.expertAct(w, q), rx, noise, T); if (r.done) okx++; }
  const ci = wilson(ok, NROLL);
  return { n, T, samples: D.X.length, copy: Math.sqrt(se / ss) * 100, own: Math.sqrt(oe / os) * 100, succ: ok / NROLL * 100, coll: co / NROLL * 100, tout: (NROLL - ok - co) / NROLL * 100, lo: ci[0] * 100, hi: ci[1] * 100, exp: okx / NEXP * 100 };
}

/* ───── the numbers the lesson quotes ───── */
const table = {};
for (let n = 1; n <= 6; n++) { table[n] = experiment(n, 20, 0, 0.05); const r = table[n]; for (const k of ['T', 'samples', 'copy', 'own', 'succ', 'coll', 'tout', 'lo', 'hi', 'exp']) F[`t${n}_${k}`] = +r[k].toFixed(3); }
const d5 = table[5];
const noise0 = experiment(5, 20, 0, 0), noise8 = experiment(5, 20, 0, 0.08), demo40 = experiment(5, 40, 0, 0.05), demo10 = experiment(5, 10, 0, 0.05), messy = experiment(5, 20, 1, 0.05);
F.noise0_succ = noise0.succ; F.noise8_succ = noise8.succ; F.demo40_copy = +demo40.copy.toFixed(3); F.demo40_succ = demo40.succ; F.demo10_copy = +demo10.copy.toFixed(3); F.demo10_succ = demo10.succ;
F.messy_succ = messy.succ; F.messy_copy = +messy.copy.toFixed(3);
F.own_copy = +d5.own.toFixed(3); F.own_ratio = +(d5.own / d5.copy).toFixed(3); F.noise0_own = +noise0.own.toFixed(3); F.noise0_copy = +noise0.copy.toFixed(3); F.t5_Ts = +(d5.T * DT).toFixed(3);
F.copy_min = Math.min(...[1, 2, 3, 4, 5, 6].map((n) => table[n].copy)); F.copy_max = Math.max(...[1, 2, 3, 4, 5, 6].map((n) => table[n].copy));
F.drop_1_6 = +(table[1].succ - table[6].succ).toFixed(3);
// per-post survival if the posts were independent trials: success(5) = s^5
F.survive_post = +(Math.pow(table[5].succ / 100, 1 / 5) * 100).toFixed(3);
// what the plant noise does to the cup in one second with no command at all (RMS distance from where it would have been)
{ const w5 = BN.slalom.world(5), r = BN.rng(7); let acc = 0; const q0 = BN.slalom.startQ(w5, 0), p0 = BN.arm.fk(q0, w5.body), TR = 2000;
  for (let k = 0; k < TR; k++) { const q = q0.slice(); for (let t = 0; t < 20; t++) gaussStep(q, [0, 0], 0.05, r); const p = BN.arm.fk(q, w5.body); acc += (p[0] - p0[0]) ** 2 + (p[1] - p0[1]) ** 2; }
  F.drift1s_mm = +(Math.sqrt(acc / TR) * 1000).toFixed(3);
  F.reach_start_cm = +(Math.hypot(p0[0], p0[1]) * 100).toFixed(3); F.h_cm = +(0.02 * Math.hypot(p0[0], p0[1]) * 100).toFixed(3); }
// the expert's own step in joint space and the time it needs
{ const w5 = BN.slalom.world(5), r = BN.rng(3); let ss = 0, cnt = 0, steps = 0; const K = 20;
  for (let k = 0; k < K; k++) { const ro = run(w5, (q) => BN.slalom.expertAct(w5, q), r, 0.05, BN.slalom.horizon(w5)); steps += ro.S.length; for (const a of ro.A) { ss += a[0] * a[0] + a[1] * a[1]; cnt++; } }
  F.step_rad = +(Math.sqrt(ss / cnt / 2) * DT).toFixed(5); F.expert_steps = +(steps / K).toFixed(1); F.expert_s = +(steps / K * DT).toFixed(2); F.kernel_frames = +(3 * 0.02 / (Math.sqrt(ss / cnt / 2) * DT)).toFixed(2); }
// where the clone's collisions happen on the five-post course
{ const w5 = BN.slalom.world(5), D = demonstrations(w5, 20, 0), pi = kernelPolicy(D), re = BN.rng(5); const T = BN.slalom.horizon(w5); const byPost = [0, 0, 0, 0, 0]; let tot = 0;
  for (let k = 0; k < NROLL; k++) { const r = run(w5, pi, re, 0.05, T); if (r.coll) { const q = r.S[r.S.length - 1], p = BN.arm.fk(q, w5.body); let bi = 0, bd = 9; w5.posts.forEach((c, i) => { const d = Math.hypot(p[0] - c[0], p[1] - c[1]); if (d < bd) { bd = d; bi = i; } }); byPost[bi]++; tot++; } }
  byPost.forEach((c, i) => { F['coll_post' + (i + 1)] = c; }); F.coll_total = tot; F.post1_share = +(byPost[0] / tot * 100).toFixed(3); F.post14_share = +((byPost[0] + byPost[3]) / tot * 100).toFixed(3); }
// how the lesson's planning arithmetic comes out: K candidates x H steps per decision at 20 Hz
const K = 100, Hh = 20, hz = 20;
F.plan_steps = K * Hh; F.plan_rate = K * Hh * hz; F.plan_ratio = K * Hh;
F.plan_ms = 200 * 25 * 0.1;                            // checkpoint: 200 candidates x 25 steps x 0.1 ms
F.ck_slow = F.plan_ms / 50; F.ck_rate = 1000 / 0.1; F.ck_steps = 200 * 25;
F.ci_half = +((table[5].hi - table[5].lo) / 2).toFixed(3); F.demo40_own = +demo40.own.toFixed(3);

/* ───── checks of the claims in the prose ───── */
check(d5.own > 3 * d5.copy && d5.own < 6 * d5.copy, 'on its own frames the clone errs 3-6 times as much as on the expert frames (got ' + (d5.own / d5.copy).toFixed(2) + ')');
check(F.copy_max < 6 && F.copy_min > 2, 'copy error stays between 2 % and 6 % for every course length');
check(table[1].succ > table[3].succ && table[3].succ > table[6].succ, 'success falls with course length');
check(table[6].succ < table[1].succ - 30, 'six posts lose more than 30 points against one');
check([1, 2, 3, 4, 5, 6].every((n) => table[n].tout === 0), 'no run of the clone stalls: every failure is a collision');
check(Math.abs(demo40.own - d5.own) < 2, 'more calm demonstrations leave the clone\'s error on its own frames about where it was (' + demo40.own.toFixed(1) + ' vs ' + d5.own.toFixed(1) + ')');
check(table[1].exp >= 98 && table[6].exp >= 96, 'the expert completes every course under the same noise');
check(noise0.succ >= 90, 'with no plant noise the clone completes the five-post course at least 90 % of the time (got ' + noise0.succ + ')');
check(noise8.succ < d5.succ - 8, 'more noise lowers success');
check(demo40.copy < d5.copy && demo40.succ - d5.succ < 12, 'doubling the demonstrations lowers copy error but lifts success by less than 12 points');
check(messy.succ > d5.succ + 10 && messy.succ < 90, 'demonstrations recorded under the deployment noise help, and do not close the gap');

/* ───── the widget prints the same numbers ───── */
const html = path.join(root, dir, '01_the_policy_contract.html');
if (fs.existsSync(html)) {
  const pg = loadPage(html);
  pg.problems.forEach((p) => fail('page problem: ' + p));
  const eqd = (id, want, digits, what) => { const got = pg.num(id); if (!(Math.abs(got - want) <= 0.5 * Math.pow(10, -digits) + 1e-9)) fail(`${what}: widget #${id} prints ${got}, independent computation gives ${want.toFixed(digits + 2)}`); };
  const setState = (n, m, noise, cond) => { pg.set('w01-n', n); pg.set('w01-demo', m); pg.set('w01-noise', noise); pg.set('w01-cond', cond ? 'messy' : 'calm'); pg.drain(); };
  const probe = (r, tag) => { eqd('w01-eps', r.copy, 1, tag + ' copy error'); eqd('w01-own', r.own, 1, tag + ' own-frame error'); eqd('w01-succ', r.succ, 1, tag + ' success'); eqd('w01-coll', r.coll, 1, tag + ' collisions'); eqd('w01-exp', r.exp, 0, tag + ' expert'); eqd('w01-T', r.T, 0, tag + ' horizon'); };
  setState(5, 20, 0.05, 0); probe(d5, 'default');
  setState(1, 20, 0.05, 0); probe(table[1], 'n=1');
  setState(6, 20, 0.05, 0); probe(table[6], 'n=6');
  setState(5, 20, 0, 0); probe(noise0, 'noise 0');
  setState(5, 40, 0.05, 0); probe(demo40, '40 demos');
  setState(5, 20, 0.05, 1); probe(messy, 'messy demos');
}

console.log(JSON.stringify({ facts: F }));
process.exit(bad ? 1 : 0);
