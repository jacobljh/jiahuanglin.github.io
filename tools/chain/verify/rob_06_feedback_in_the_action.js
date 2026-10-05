#!/usr/bin/env node
'use strict';
/* Oracle for robot_model_training lesson 06 (targets, not velocities: feedback in the action).
 * Re-derives every number the lesson quotes with code written separately from tracker_lab.js: its own recording of the 20 demonstrations, a brute-force nearest-frame
 * lookup over typed arrays (no grid), its own plant with a delay line, its own chunk, tracker, drift and outcome logic, its own Wilson interval and path curve.
 * Only the world's primitives (arm, expert, start pose) come from bench.js.  Closed forms (random-walk drift, spread of a loop, the delay ceiling) are checked against
 * simulation, the ceiling also against the roots of the characteristic polynomial.  Then the oracle drives the page's widget and checks that what it prints is what the
 * independent computation gives.  Last stdout line: {"facts": {...}}. */
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

/* ───── the demonstrations, recorded again: 20 calm expert runs on five posts from jittered starts, stored frame by frame ───── */
const DT = 0.05, BW = 0.02, JIT = 0.01, NPOST = 5, NDEMO = 20, NROLL = 200, SEED = 5, CONTACT = 0.05, VMAX = 1.5;
const W = BN.slalom.world(NPOST), T = BN.slalom.horizon(W), XE = BN.slalom.xEnd(W), L1 = W.body.L1, L2 = W.body.L2;
const cup = (q) => [L1 * Math.cos(q[0]) + L2 * Math.cos(q[0] + q[1]), L1 * Math.sin(q[0]) + L2 * Math.sin(q[0] + q[1])];
const demo = [];                                         // per demonstration: S (joint states, including the last one) and A (commands)
{
  const rng = BN.rng(1);
  for (let k = 0; k < NDEMO; k++) {
    const q = BN.slalom.startQ(W, JIT * BN.randn(rng)).slice(), S = [], A = [];
    for (let t = 0; t < T; t++) {
      S.push(q.slice()); const p = cup(q);
      if (p[0] > XE - 0.02) break;                       // calm demonstration: nothing collides, the expert finishes
      const u = BN.slalom.expertAct(W, q); A.push(u);
      q[0] += DT * Math.max(-VMAX, Math.min(VMAX, u[0])); q[1] += DT * Math.max(-VMAX, Math.min(VMAX, u[1]));
    }
    demo.push({ S, A });
  }
  // the same frames as the Bench's own recorder would give
  const ref = BN.demos(W, NDEMO, BN.rng(1), { noise: 0, jit: JIT });
  check(ref.every((ro, k) => ro.A.length === demo[k].A.length && Math.abs(ro.S[ro.S.length - 1][0] - demo[k].S[demo[k].S.length - 1][0]) < 1e-12), 'own demonstrations equal BN.demos');
}
const FX = [], FY = [], FR = [], FT = [];                // every stored frame that has a command
demo.forEach((d, r) => { for (let t = 0; t < d.A.length; t++) { FX.push(d.S[t][0]); FY.push(d.S[t][1]); FR.push(r); FT.push(t); } });
const NF = FX.length, fx = Float64Array.from(FX), fy = Float64Array.from(FY);
F.frames = NF; F.T = T;
function nearest(q) {                                    // brute force over every stored frame
  let best = 0, bd = Infinity;
  for (let i = 0; i < NF; i++) { const dx = fx[i] - q[0], dy = fy[i] - q[1], e = dx * dx + dy * dy; if (e < bd) { bd = e; best = i; } }
  return best;
}
/* the path the demonstrations took: mean cup height in 1 mm bins of x, gaps bridged by straight lines (written again, differently: sort the points, then sweep) */
const pts = [];
demo.forEach((d) => d.S.forEach((q) => { const p = cup(q); pts.push(p); }));
const XMIN = -0.56, XB = 0.001, NB = 1200;
const yd = (() => {
  const s = new Array(NB + 1).fill(0), c = new Array(NB + 1).fill(0);
  pts.slice().sort((a, b) => a[0] - b[0]).forEach((p) => { const i = Math.round((p[0] - XMIN) / XB); if (i >= 0 && i <= NB) { s[i] += p[1]; c[i]++; } });
  const known = []; for (let i = 0; i <= NB; i++) if (c[i]) known.push(i);
  const y = new Array(NB + 1);
  for (let i = 0; i <= NB; i++) {
    if (c[i]) { y[i] = s[i] / c[i]; continue; }
    const a = known.filter((k) => k < i).pop(), b = known.find((k) => k > i);
    y[i] = a === undefined ? s[b] / c[b] : b === undefined ? s[a] / c[a] : (s[a] / c[a]) + ((s[b] / c[b]) - (s[a] / c[a])) * (i - a) / (b - a);
  }
  return y;
})();
const pathY = (x) => { const f = (x - XMIN) / XB, i = Math.max(0, Math.min(NB - 1, Math.floor(f))), a = f - i; return yd[i] * (1 - a) + yd[i + 1] * a; };

/* ───── one rollout of one kind of chunk, written out ───── */
const POSTS = (shift) => W.posts.map((p) => [p[0], p[1] + shift]);
function wilson(k, n) { const z = 1.96, p = k / n, d = 1 + z * z / n, c = (p + z * z / (2 * n)) / d, h = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d; return [Math.max(0, c - h), Math.min(1, c + h)]; }
function once(kind, H, K, pl, i, shift, opt) {           // returns {outcome, drift: [squared distances], endDev}
  opt = opt || {};
  const rng = BN.rng(1000 * SEED + i + 1), g = pl.gain === undefined ? 1 : pl.gain, sg = pl.noise || 0, dl = pl.delay || 0, h = H > 0 ? H : T, posts = POSTS(shift || 0);
  const q = BN.slalom.startQ(W, JIT * BN.randn(rng)).slice(), pending = [];
  for (let k = 0; k < dl; k++) pending.push([0, 0]);
  let ref = [0, 0], rr = 0, t0 = 0, coll = -1, done = -1; const drift = [];
  for (let t = 0; t < T; t++) {
    const p = cup(q);
    if (opt.rec) opt.rec.push(p);
    if (coll < 0) for (const c of posts) if (Math.hypot(p[0] - c[0], p[1] - c[1]) < CONTACT) { coll = t; break; }
    if (p[0] > XE - 0.02) { done = t; break; }
    const j = t % h;
    if (j === 0) {
      if (t > 0) { const e = cup(ref); drift.push((p[0] - e[0]) ** 2 + (p[1] - e[1]) ** 2); }
      const id = nearest(q); rr = FR[id]; t0 = FT[id]; ref = q.slice();
    }
    const D = demo[rr], tt = t0 + j; let u;
    const stored = tt < D.A.length ? D.A[tt] : [0, 0];
    if (kind === 'vel') { u = stored; ref = [ref[0] + DT * stored[0], ref[1] + DT * stored[1]]; }
    else {
      if (kind === 'rel') ref = [ref[0] + DT * stored[0], ref[1] + DT * stored[1]];
      else { const s = D.S[Math.min(tt + 1, D.S.length - 1)]; ref = [s[0], s[1]]; }
      u = [K * (ref[0] - q[0]), K * (ref[1] - q[1])];
    }
    pending.push(u); const ua = dl ? pending.shift() : pending.pop();     // the command that reaches the joints now: dl steps old
    const n0 = sg ? sg * BN.randn(rng) : 0, n1 = sg ? sg * BN.randn(rng) : 0;
    q[0] += DT * (Math.max(-VMAX, Math.min(VMAX, ua[0])) * g + n0);
    q[1] += DT * (Math.max(-VMAX, Math.min(VMAX, ua[1])) * g + n1);
    if (opt.kick && opt.kick.t === t) { q[0] += opt.kick.dq[0]; q[1] += opt.kick.dq[1]; }
  }
  const p = cup(q);
  if (H === 0) { const e = cup(ref); drift.push((p[0] - e[0]) ** 2 + (p[1] - e[1]) ** 2); }
  const dv = p[1] - pathY(p[0]);
  const outcome = done >= 0 && (coll < 0 || coll > done) ? 'ok' : coll >= 0 ? 'coll' : 'tout';
  return { outcome, drift, endDev2: dv * dv, q };
}
const cache = {};
function setting(kind, H, K, pl, shift) {                // N = 200 rollouts of one setting, the numbers the lesson quotes
  const key = JSON.stringify([kind, H, K, pl, shift || 0]); if (cache[key]) return cache[key];
  let ok = 0, co = 0, to = 0, ds = 0, dn = 0, es = 0;
  for (let i = 0; i < NROLL; i++) { const r = once(kind, H, K, pl, i, shift); if (r.outcome === 'ok') ok++; else if (r.outcome === 'coll') co++; else to++; r.drift.forEach((x) => { ds += x; dn++; }); es += r.endDev2; }
  const ci = wilson(ok, NROLL);
  return (cache[key] = { succ: ok / NROLL * 100, coll: co / NROLL * 100, tout: to / NROLL * 100, lo: ci[0] * 100, hi: ci[1] * 100, drift: dn ? Math.sqrt(ds / dn) * 100 : NaN, endDev: Math.sqrt(es / NROLL) * 100 });
}
const HS = [1, 2, 4, 8, 16, 32, 64, 0], HN = (H) => (H === 0 ? T : H);
const NEW = { gain: 1, noise: 0.05 }, WORN = { gain: 0.85, noise: 0.08 }, CALM_WORN = { gain: 0.85, noise: 0 };

/* ───── the geometry of the course: how far a copy can stray ───── */
let nearMin = 9;
{ for (const c of W.posts) for (const p of pts) nearMin = Math.min(nearMin, Math.hypot(p[0] - c[0], p[1] - c[1])); }
F.near_cm = nearMin * 100; F.margin_cm = (nearMin - CONTACT) * 100;
const clearance = (s) => { let m = 9; for (const c of POSTS(s)) for (const p of pts) m = Math.min(m, Math.hypot(p[0] - c[0], p[1] - c[1])); return (m - CONTACT) * 100; };
// ‖J‖_F along the demonstrated path, the cup's path length per step, and the closed form of the drift of a velocity chunk
let jf = 0, jn = 0, sp = 0, sn = 0;
demo.forEach((d) => d.S.forEach((q, t) => {
  const J = BN.arm.jac(q, W.body); jf += Math.sqrt(J[0] ** 2 + J[1] ** 2 + J[2] ** 2 + J[3] ** 2); jn++;
  if (t + 1 < d.S.length && t < d.A.length) { const a = cup(q), b = cup(d.S[t + 1]); sp += Math.hypot(b[0] - a[0], b[1] - a[1]); sn++; }
}));
const JF = jf / jn, VSTEP = sp / sn;                     // m per radian; m per step
F.jf = JF; F.vstep_cm = VSTEP * 100;
const walk = (sigma) => DT * sigma * JF * 100;           // cm per sqrt(step)
const biasStep = (g) => (1 - g) * VSTEP * 100;           // cm per step
const predDrift = (g, sigma, H) => Math.sqrt(Math.pow(walk(sigma), 2) * H + Math.pow(biasStep(g) * H, 2));
const hstar = (g, sigma, m) => { const a = Math.pow(walk(sigma), 2), b = Math.pow(biasStep(g), 2); return b > 0 ? (-a + Math.sqrt(a * a + 4 * b * m * m)) / (2 * b) : m * m / a; };
F.step_w_cm = walk(0.08); F.step_n_cm = walk(0.05); F.bias_w_cm = biasStep(0.85);
F.Hstar_w = hstar(0.85, 0.08, F.margin_cm); F.Hstar_n = hstar(1, 0.05, F.margin_cm);
// the checkpoint exercise: a 40-step velocity chunk on the worn arm
F.ck_rand = walk(0.08) * Math.sqrt(40); F.ck_sys = biasStep(0.85) * 40; F.ck_tot = Math.hypot(F.ck_rand, F.ck_sys); F.ck_ratio = F.ck_tot / F.margin_cm;

/* ───── §1: velocity chunks on the two arms, the table and its closed form ───── */
for (const H of HS) {
  const n = setting('vel', H, 20, NEW), w = setting('vel', H, 20, WORN), k = HN(H);
  F['n_vel_s' + k] = n.succ; F['n_vel_d' + k] = n.drift; F['w_vel_s' + k] = w.succ; F['w_vel_d' + k] = w.drift;
  F['n_vel_ci_lo' + k] = n.lo; F['n_vel_ci_hi' + k] = n.hi; F['w_vel_ci_lo' + k] = w.lo; F['w_vel_ci_hi' + k] = w.hi;
  F['w_vel_c' + k] = w.coll; F['w_vel_t' + k] = w.tout; F['n_vel_c' + k] = n.coll;
  F['n_pred' + k] = predDrift(1, 0.05, k); F['w_pred' + k] = predDrift(0.85, 0.08, k);
}
{ const ss = HS.map((H) => F['w_vel_s' + HN(H)]); F.w_best = Math.max(...ss); F.w_best_H = HN(HS[ss.indexOf(F.w_best)]);
  const sn_ = HS.map((H) => F['n_vel_s' + HN(H)]); F.n_best = Math.max(...sn_); F.n_best_H = HN(HS[sn_.indexOf(F.n_best)]); }
{ // calm arm, gain error only: the drift is the intended displacement times (1 - g), linear in the chunk length
  for (const H of [4, 8, 16]) { const c = setting('vel', H, 20, CALM_WORN); F['c_vel_s' + H] = c.succ; F['c_vel_d' + H] = c.drift; F['c_pred' + H] = predDrift(0.85, 0, H); F['c_vel_t' + H] = c.tout; F['c_vel_c' + H] = c.coll; } }
{ const xs = [4, 8, 16, 32, 64], f = BN.stats.logslope(xs, xs.map((H) => F['n_vel_d' + H])); F.n_slope = f.slope; F.n_slope_r2 = f.r2; }

/* ───── §2: the tracker.  A shove tests the loop gain directly ───── */
function shove(kind, H, K, pl, dir, t0s, ms) {          // ratio of the cup's displacement from the unshoved run, m steps after the shove, to the shove itself (m in ms)
  const dq = [0.012 * Math.cos(dir), 0.012 * Math.sin(dir)], out = ms.map(() => []);
  t0s.forEach((ts) => {
    const recA = [], recB = [];
    once(kind, H, K, pl, 0, 0, { rec: recA }); once(kind, H, K, pl, 0, 0, { rec: recB, kick: { t: ts, dq } });
    const d = (m) => Math.hypot(recB[ts + 1 + m][0] - recA[ts + 1 + m][0], recB[ts + 1 + m][1] - recA[ts + 1 + m][1]);
    ms.forEach((m, i) => out[i].push(d(m) / d(0)));
  });
  return out;
}
{
  const calm = { gain: 0.85, noise: 0 }, mean = (a) => a.reduce((x, y) => x + y) / a.length, dirs = [0, 1, 2, 3, 4, 5, 6, 7].map((a) => a * Math.PI / 4);
  const all = (kind, H, K, t0s, ms) => { const out = ms.map(() => []); dirs.forEach((d) => shove(kind, H, K, calm, d, t0s, ms).forEach((r, i) => out[i].push(...r))); return out; };
  const mid = [50, 66, 82, 98, 114, 130];                 // each lands at step 2 of a 16-step chunk: one and eight steps later it is still inside that chunk
  const v = all('vel', 16, 20, mid, [1, 8]), a = all('abs', 16, 20, mid, [1, 8]), r = all('rel', 16, 20, mid, [1, 8]);
  F.kick_vel_1 = mean(v[0]); F.kick_vel_8 = mean(v[1]); F.kick_vel_8_lo = Math.min(...v[1]); F.kick_vel_8_hi = Math.max(...v[1]);
  F.kick_abs_1 = mean(a[0]); F.kick_abs_8 = mean(a[1]); F.kick_rel_1 = mean(r[0]); F.kick_rel_8 = mean(r[1]);
  // looking again at every step (H = 1): the lookup is itself a loop through the stored data; what is left of a shove twenty steps later?
  const h1 = all('vel', 1, 20, [30, 50, 70, 90, 110, 130, 150], [20])[0];
  F.kick_h1_20 = mean(h1); F.kick_h1_20_lo = Math.min(...h1); F.kick_h1_20_hi = Math.max(...h1);
}
// the spread a loop with gain J leaves, per joint, against its closed form (Monte Carlo of e' = J e + dt sigma xi)
{
  const rg = BN.rng(11), sim = (J) => { let s2 = 0; const N = 40000; let e = 0; for (let t = 0; t < 200; t++) e = J * e + DT * 0.08 * BN.randn(rg); for (let k = 0; k < N; k++) { e = J * e + DT * 0.08 * BN.randn(rg); s2 += e * e; } return Math.sqrt(s2 / N); };
  for (const k of [0.15, 0.5, 0.85, 1]) {
    const closed = DT * 0.08 / Math.sqrt(k * (2 - k)), mc = sim(1 - k);
    F['spread_cf_k' + Math.round(k * 100)] = closed * JF * 100; check(Math.abs(mc - closed) < 0.03 * closed + 1e-6 || k === 1, 'spread of the loop with J = ' + (1 - k).toFixed(2) + ': simulation ' + mc + ' vs closed form ' + closed);
  }
}

/* ───── §3: relative to what? ───── */
for (const H of HS) {
  const k = HN(H), w = setting('rel', H, 20, WORN), a = setting('abs', H, 20, WORN), n = setting('rel', H, 20, NEW), na = setting('abs', H, 20, NEW), v = setting('vel', H, 20, WORN);
  F['w_rel_s' + k] = w.succ; F['w_rel_d' + k] = w.drift; F['w_rel_e' + k] = w.endDev; F['w_abs_s' + k] = a.succ; F['w_abs_d' + k] = a.drift; F['w_abs_e' + k] = a.endDev;
  F['n_rel_s' + k] = n.succ; F['n_abs_s' + k] = na.succ; F['n_abs_d' + k] = na.drift; F['w_vel_e' + k] = v.endDev;
  F['w_abs_ci_lo' + k] = a.lo;
}
F.abs_min_w = Math.min(...HS.map((H) => F['w_abs_s' + HN(H)])); F.abs_min_n = Math.min(...HS.map((H) => F['n_abs_s' + HN(H)]));
F.abs_e_max = Math.max(...HS.map((H) => F['w_abs_e' + HN(H)])); F.abs_e_min = Math.min(...HS.map((H) => F['w_abs_e' + HN(H)]));
F.abs_d_lo = Math.min(...HS.map((H) => F['w_abs_d' + HN(H)])); F.abs_d_hi = Math.max(...HS.map((H) => F['w_abs_d' + HN(H)]));

/* ───── §4: what stiffness costs: the delay ceiling, by three routes; soft trackers ───── */
const kcrit = (d) => 2 * Math.sin(Math.PI / (4 * d + 2));
for (let d = 0; d <= 3; d++) { F['kc' + d] = kcrit(d); F['Kmax' + d] = kcrit(d) / (DT * 0.85); F['Kmax1_' + d] = kcrit(d) / DT; }
{ // (a) the deterministic loop e(t+1) = e(t) - k e(t - d): bisection on k for the largest k whose response decays; (b) the roots of z^(d+1) - z^d + k
  const decays = (k, d) => { const e = new Array(d + 1).fill(0); e[d] = 1; let p1 = 0, p2 = 0; for (let t = 0; t < 12000; t++) { const nx = e[d] - k * e[0]; e.shift(); e.push(nx); if (t >= 4000 && t < 8000) p1 = Math.max(p1, Math.abs(nx)); else if (t >= 8000) p2 = Math.max(p2, Math.abs(nx)); } return p2 <= p1 * (1 + 1e-12); };   // the response must not grow between two late windows
  const modulus = (k, d) => {                          // largest root modulus by Durand-Kerner on z^(d+1) - z^d + k
    const n = d + 1, coef = new Array(n + 1).fill(0); coef[0] = 1; coef[1] = -1; coef[n] += k;          // highest power first
    let z = []; for (let i = 0; i < n; i++) z.push([Math.cos(0.4 + 2 * Math.PI * i / n) * 0.9, Math.sin(0.4 + 2 * Math.PI * i / n) * 0.9]);
    const mul = (a, b) => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]], div = (a, b) => { const m = b[0] * b[0] + b[1] * b[1]; return [(a[0] * b[0] + a[1] * b[1]) / m, (a[1] * b[0] - a[0] * b[1]) / m]; };
    for (let it = 0; it < 400; it++) for (let i = 0; i < n; i++) {
      let pv = [coef[0], 0]; for (let c = 1; c <= n; c++) pv = mul(pv, z[i]), pv[0] += coef[c];
      let den = [1, 0]; for (let j = 0; j < n; j++) if (j !== i) den = mul(den, [z[i][0] - z[j][0], z[i][1] - z[j][1]]);
      const dz = div(pv, den); z[i] = [z[i][0] - dz[0], z[i][1] - dz[1]];
    }
    return Math.max(...z.map((a) => Math.hypot(a[0], a[1])));
  };
  for (let d = 0; d <= 3; d++) {
    let lo = 0.01, hi = 2.5; for (let it = 0; it < 40; it++) { const mid = (lo + hi) / 2; if (decays(mid, d)) lo = mid; else hi = mid; }
    F['kc_sim' + d] = lo; F['kc_root' + d] = (() => { let a = 0.01, b = 2.5; for (let it = 0; it < 40; it++) { const m = (a + b) / 2; if (modulus(m, d) < 1 - 1e-9) a = m; else b = m; } return a; })();
    check(Math.abs(lo - kcrit(d)) < 0.01 && Math.abs(F['kc_root' + d] - kcrit(d)) < 0.01, 'delay ' + d + ': ceiling on k is 2 sin(pi/(4d+2)) = ' + kcrit(d).toFixed(4) + ' (simulated ' + lo.toFixed(4) + ', roots ' + F['kc_root' + d].toFixed(4) + ')');
  }
}
{ // absolute targets, 64-step chunks, worn arm, K just under and well over the ceiling
  const cases = [[1, 20], [1, 30], [2, 10], [2, 15], [2, 20], [3, 6], [3, 10], [3, 12]];
  cases.forEach(([d, K]) => { const s = setting('abs', 64, K, Object.assign({ delay: d }, WORN)); F['dl' + d + '_K' + K] = s.succ; F['dl' + d + '_k' + K] = K * DT * 0.85; });
  F.dl0_K40 = setting('abs', 64, 40, WORN).succ; F.dl0_k40 = 40 * DT * 0.85;
  for (const K of [3, 5, 8, 10, 15]) for (const H of [1, 4, 8, 16, 32, 64]) F['soft_K' + K + '_H' + H] = setting('abs', H, K, WORN).succ;
  for (const K of [3, 5, 8, 10, 15]) F['soft_k' + K] = K * DT * 0.85;
  // a soft tracker trails its target by (1 - k) / k steps and every chunk start loses that many; the course allows T steps for the demonstrated length
  F.demo_len = NF / NDEMO; F.lag_rule = 1 / (1 - F.demo_len / T);
  for (const K of [5, 10, 15]) { const k = K * DT * 0.85; F['lag_H' + K] = F.lag_rule * (1 - k) / k; }
  for (const K of [5, 10, 15]) for (const H of [1, 4, 8, 16, 32]) { const c = setting('abs', H, K, WORN); F['soft_t_K' + K + '_H' + H] = c.tout; F['soft_c_K' + K + '_H' + H] = c.coll; }
}

/* ───── §5: units and resolution: round the targets to the middle of a bin over [-pi, pi] ───── */
{
  const need = (F.margin_cm / 100) / JF; F.res_req_rad = need; F.res_req_deg = need * 180 / Math.PI;
  const qz = (B) => { const w = 2 * Math.PI / B; return (x) => -Math.PI + (Math.floor((x + Math.PI) / w) + 0.5) * w; };
  const once_q = (B, i) => {                           // an absolute-target chunk of 8 steps whose targets are rounded to B bins, worn arm
    const rng = BN.rng(1000 * SEED + i + 1), qf = qz(B), q = BN.slalom.startQ(W, JIT * BN.randn(rng)).slice(); let rr = 0, t0 = 0, coll = -1, done = -1; const posts = POSTS(0);
    for (let t = 0; t < T; t++) {
      const p = cup(q); if (coll < 0) for (const c of posts) if (Math.hypot(p[0] - c[0], p[1] - c[1]) < CONTACT) { coll = t; break; }
      if (p[0] > XE - 0.02) { done = t; break; }
      const j = t % 8; if (j === 0) { const id = nearest(q); rr = FR[id]; t0 = FT[id]; }
      const D = demo[rr], s = D.S[Math.min(t0 + j + 1, D.S.length - 1)], tg = [qf(s[0]), qf(s[1])];
      const u = [20 * (tg[0] - q[0]), 20 * (tg[1] - q[1])];
      const n0 = 0.08 * BN.randn(rng), n1 = 0.08 * BN.randn(rng);
      q[0] += DT * (Math.max(-VMAX, Math.min(VMAX, u[0])) * 0.85 + n0); q[1] += DT * (Math.max(-VMAX, Math.min(VMAX, u[1])) * 0.85 + n1);
    }
    return done >= 0 && (coll < 0 || coll > done) ? 'ok' : coll >= 0 ? 'coll' : 'tout';
  };
  for (const B of [512, 256, 128, 64]) {
    const qf = qz(B); let s2 = 0, mx = 0, n = 0;
    demo.forEach((d) => d.S.forEach((q) => { const a = cup(q), b = cup([qf(q[0]), qf(q[1])]), e = Math.hypot(a[0] - b[0], a[1] - b[1]); s2 += e * e; mx = Math.max(mx, e); n++; }));
    F['bin_w_' + B] = 2 * Math.PI / B; F['qerr_rms_' + B] = Math.sqrt(s2 / n) * 100; F['qerr_max_' + B] = mx * 100;
    let ok = 0, co = 0; for (let i = 0; i < NROLL; i++) { const o = once_q(B, i); if (o === 'ok') ok++; else if (o === 'coll') co++; }
    F['qs_' + B] = ok / NROLL * 100; F['qc_' + B] = co / NROLL * 100;
  }
  F.half_bin_256 = F.bin_w_256 / 2; F.qerr_max_256_pct = F.qerr_max_256 / F.margin_cm * 100;
}

/* ───── §6: shift the posts (the arm still starts where the demonstrations started) ───── */
for (const s of [-2, -1, 0, 1, 2, 3]) {
  const key = s < 0 ? 'm' + (-s) : 'p' + s;
  F['cl_' + key] = clearance(s / 100); F['sh_abs_' + key] = setting('abs', 16, 20, WORN, s / 100).succ; F['sh_vel_' + key] = setting('vel', 4, 20, WORN, s / 100).succ;
  F['sh_abs_new_' + key] = setting('abs', 16, 20, NEW, s / 100).succ; F['sh_velnew_' + key] = setting('vel', 4, 20, NEW, s / 100).succ;
}
{ F.cl_slope = Math.abs((clearance(0.02) - clearance(0)) / 2); F.cl_zero = F.margin_cm / F.cl_slope; }
F.sh_abs_touch_p2 = setting('abs', 16, 20, WORN, 0.02).coll; F.sh_abs_touch_p3 = setting('abs', 16, 20, WORN, 0.03).coll;

/* ───── gain and gust sweeps for 'What to try' ───── */
for (const g of [1, 0.7]) { const v = setting('vel', 16, 20, { gain: g, noise: 0.08 }), a = setting('abs', 16, 20, { gain: g, noise: 0.08 }); F['gs_vel_s' + Math.round(g * 100)] = v.succ; F['gs_vel_d' + Math.round(g * 100)] = v.drift; F['gs_abs_s' + Math.round(g * 100)] = a.succ; F['gs_abs_d' + Math.round(g * 100)] = a.drift; }
{ const v = setting('vel', 16, 20, { gain: 1, noise: 0.05 }), a = setting('abs', 16, 20, { gain: 1, noise: 0.05 }); F.gu_vel_s = v.succ; F.gu_vel_d = v.drift; F.gu_abs_d = a.drift; F.gu_abs_s = a.succ; }

/* ───── claims of the prose, asserted ───── */
check(F.margin_cm > 1.4 && F.margin_cm < 1.7 && F.near_cm > 6.4 && F.near_cm < 6.7, 'the demonstrated path clears the nearest post centre by about 6.5 cm, a margin of about 1.5 cm (got ' + F.near_cm + ')');
check(HS.every((H) => Math.abs(F['n_vel_d' + HN(H)] - F['n_pred' + HN(H)]) < 0.06 * F['n_pred' + HN(H)] + 0.01), 'drift of velocity chunks on the new arm equals dt sigma |J|_F sqrt(H) to within 6 % up to the whole course');
check([1, 2, 4, 8, 16].every((H) => Math.abs(F['w_vel_d' + H] - F['w_pred' + H]) < 0.03 * F['w_pred' + H]), 'drift of velocity chunks on the worn arm equals the quadrature of the random and the systematic part to within 3 % up to 16 steps');
check([32, 64, 235].every((H) => F['w_pred' + H] >= F['w_vel_d' + H] && F['w_pred' + H] < 1.45 * F['w_vel_d' + H]), 'beyond 16 steps the closed form is an upper bound (the path bends, so the chord is shorter than the arc)');
check([4, 8, 16].every((H) => Math.abs(F['c_vel_d' + H] - F['c_pred' + H]) < 0.1 * F['c_pred' + H]), 'with no noise the drift is the gain shortfall times the displacement, linear in the chunk length');
check(F.n_slope > 0.42 && F.n_slope < 0.58 && F.n_slope_r2 > 0.98, 'on the new arm the drift of velocity chunks grows as the square root of the chunk length (slope ' + F.n_slope + ')');
check(F.n_vel_s4 > F.n_vel_s1 + 10 && F.n_vel_s4 > F.n_vel_s64 + 20 && F.n_vel_s64 > F.n_vel_s235, 'velocity chunks on the new arm: success rises first and then falls as the chunk grows (hump)');
check(F.w_best < 50 && F.w_vel_s32 < 5 && F.w_vel_s64 < 5 && F.w_vel_s235 < 5, 'on the worn arm no velocity chunk exceeds 50 % and chunks of 32 steps or more almost never succeed');
check(F.w_vel_d8 < F.margin_cm && F.w_vel_d16 > F.margin_cm && F.Hstar_w > 8 && F.Hstar_w < 16, 'worn arm: the drift crosses the margin between 8 and 16 steps, where the closed form puts H* (' + F.Hstar_w + ')');
check(F.n_vel_d32 < F.margin_cm && F.n_vel_d64 > 0.9 * F.margin_cm && F.Hstar_n > 45 && F.Hstar_n < 70, 'new arm: the drift reaches the margin near 58 steps');
check(F.c_vel_s8 >= 95 && F.c_vel_s16 <= 5, 'with no noise at all a gain of 0.85 passes chunks of 8 steps and fails chunks of 16');
check(F.abs_min_w >= 99 && F.abs_min_n >= 99, 'absolute targets with a stiff tracker complete the course at every chunk length on both arms (worn ' + F.abs_min_w + ', new ' + F.abs_min_n + ')');
check(F.abs_d_hi < 0.45 && F.abs_d_lo > 0.1 && F.abs_d_hi < 0.3 * F.margin_cm, 'the drift after a chunk of absolute targets stays under 0.45 cm at every chunk length, far inside the margin');
check(Math.abs(F.w_rel_s1 - F.w_vel_s1) < 1e-9 && F.w_rel_s2 < 90 && F.w_rel_s4 > 90 && F.w_rel_s16 >= 99, 'relative targets: H = 1 is the velocity policy, short chunks leak, chunks of 8 or more complete');
check([8, 16, 32, 64, 235].every((H) => F['w_rel_s' + H] >= 99.5) && F.w_rel_e8 < 0.3, 'targets measured from the arm complete every run from 8 steps on, and the arm ends within 0.3 cm of the path');
check(demo.every((d) => d.A.every((u, t) => Math.abs(d.S[t + 1][0] - d.S[t][0] - DT * Math.max(-VMAX, Math.min(VMAX, u[0]))) < 1e-12 && Math.abs(d.S[t + 1][1] - d.S[t][1] - DT * Math.max(-VMAX, Math.min(VMAX, u[1]))) < 1e-12)), 'the stored poses are the integral of the stored commands (targets that nothing tracks are the same chunk as velocities)');
check(F.w_rel_e1 > 5 * F.w_abs_e1 && F.w_rel_e1 > F.w_rel_e2 && F.w_rel_e2 > F.w_rel_e4 && F.w_rel_e4 > F.w_rel_e8, 'relative targets leave the arm further from the path at the end of the course the shorter the chunks, absolute targets do not');
check(Math.abs(F.kick_vel_1 - 1) < 0.01 && F.kick_vel_8_lo > 0.9 && F.kick_vel_8_hi < 1.1, 'a shove inside a velocity chunk is still there one and eight steps later (J = 1; the cup distance moves with the Jacobian by a few per cent)');
check(Math.abs(F.kick_abs_1 - 0.15) < 0.01 && F.kick_abs_8 < 0.01 && F.kick_rel_8 < 0.01, 'a shove inside a tracked chunk is a share 1 - k of itself one step later and gone after eight');
check(F.kick_h1_20 > 1.05 && F.kick_h1_20_hi > 1.5 && F.kick_h1_20_lo < 0.7, 'looking again at every step does not remove a shove: after twenty steps it is left at about 1.1 times its size on average, from about half to twice its size depending on where and which way');
check(F.dl1_K20 > 90 && F.dl1_K30 < 5 && F.dl2_K10 > 90 && F.dl2_K15 < 5 && F.dl3_K6 > 90 && F.dl3_K12 < 5 && F.dl0_K40 > 99, 'the ceiling on stiffness falls with delay, as the formula says');
check(F.dl3_K10 < 60 && F.dl3_K10 > 0, 'just under the ceiling the loop rings and success is already poor (d = 3, K = 10)');
check(F.soft_K10_H1 < 5 && F.soft_K10_H8 > 95 && F.soft_K5_H8 < 20 && F.soft_K5_H32 > 90 && F.soft_K15_H4 > 95 && F.soft_K15_H1 < 5, 'a soft tracker needs longer chunks: K = 15 from 4 steps, K = 10 from 8, K = 5 from 32');
{ let rule = true, tout = true;
  for (const K of [5, 10, 15]) for (const H of [1, 4, 8, 16, 32]) {
    const ok = F['soft_K' + K + '_H' + H] >= 90; if (ok !== (H > F['lag_H' + K])) rule = false;
    if (F['soft_K' + K + '_H' + H] < 90 && F['soft_c_K' + K + '_H' + H] > 0) tout = false;
  }
  check(rule, 'soft trackers complete the course exactly when the chunk is longer than lag_rule (1 - k) / k steps (K = 5, 10, 15; H = 1, 4, 8, 16, 32)');
  check(tout, 'every failure of a soft tracker in the table is a timeout, not a collision'); }
check(F.qerr_max_256 < F.margin_cm && F.qerr_max_256 > 0.9 * F.margin_cm && F.qerr_max_128 > F.margin_cm && F.qs_256 >= 99 && F.qs_64 < 70 && F.qc_64 > 30, 'the largest rounding error of 256 bins just fits the margin; 64 bins fail');
check(F.cl_p1 > 0.5 && F.cl_p2 < 0.05 && F.cl_p2 > -0.15 && F.cl_p3 < -0.5, 'the demonstrated path clears the shifted posts by about 0.8 cm at +1 and none at +2');
check(F.sh_abs_p0 >= 99 && F.sh_abs_p1 >= 99 && F.sh_abs_m1 >= 99 && F.sh_abs_p2 < 10 && F.sh_abs_p3 === 0 && F.sh_abs_m2 < 10, 'absolute targets: success 100 % within a centimetre of shift, nearly 0 at two');
check(F.sh_vel_p2 < F.sh_vel_p0 && F.sh_vel_p3 < 5, 'velocity chunks fall over the same shifts');
check(F.gs_vel_s70 < 5 && F.gs_abs_s70 >= 99 && F.gs_abs_s100 >= 99 && F.gs_vel_s100 < F.gs_abs_s100 - 20, 'the gain sweep: velocity chunks fall with the gain, tracked targets do not');

/* ───── the widget prints the same numbers ───── */
const html = path.join(root, dir, '06_feedback_in_the_action.html');
if (fs.existsSync(html)) {
  const pg = loadPage(html);
  pg.problems.forEach((p) => fail('page problem: ' + p));
  const eqd = (id, want, digits, what) => { const got = pg.num(id); if (!(Math.abs(got - want) <= 0.5 * Math.pow(10, -digits) + 1e-9)) fail(`${what}: widget #${id} prints ${got}, independent computation gives ${want.toFixed(digits + 2)}`); };
  const KIND = { vel: 'vel', rel: 'rel', abs: 'abs' };
  const cur = {};
  const state = (hIdx, kind, K, delay, gain, gust, shift) => {          // set only the controls that differ from what the page already holds
    const want = { 'w06-H': hIdx, 'w06-out': KIND[kind], 'w06-K': K, 'w06-delay': delay, 'w06-gain': gain, 'w06-gust': gust, 'w06-shift': shift };
    for (const id of Object.keys(want)) if (cur[id] !== want[id]) { pg.set(id, want[id]); cur[id] = want[id]; }
    pg.drain();
  };
  const probe = (kind, H, K, pl, shift, tag) => {
    const s = setting(kind, H, K, pl, shift / 100);
    eqd('w06-succ', s.succ, 1, tag + ' success'); eqd('w06-ci', s.lo, 1, tag + ' interval low'); eqd('w06-coll', s.coll, 1, tag + ' touches'); eqd('w06-tout', s.tout, 1, tag + ' timeouts');
    if (!isNaN(s.drift)) eqd('w06-drift', s.drift, 2, tag + ' drift after a chunk'); eqd('w06-end', s.endDev, 2, tag + ' distance from the path at the end');
    eqd('w06-clear', clearance(shift / 100), 2, tag + ' clearance');
    const k = K * DT * (pl.gain === undefined ? 1 : pl.gain), stab = pg.text('w06-stab');
    if (kind === 'vel') { eqd('w06-J', 1, 2, tag + ' loop gain'); check(/no tracker/.test(stab), tag + ' stability text for a velocity chunk: ' + stab); }
    else { eqd('w06-J', 1 - k, 2, tag + ' loop gain'); eqd('w06-stab', k, 2, tag + ' k'); const unstable = k >= kcrit(pl.delay || 0); check(unstable === /unstable/.test(stab), tag + ' stability flag says "' + stab + '" for k = ' + k.toFixed(3) + ' and delay ' + (pl.delay || 0)); }
  };
  const IDX = { 1: 0, 2: 1, 4: 2, 8: 3, 16: 4, 32: 5, 64: 6, 0: 7 };
  state(IDX[16], 'vel', 20, 0, 0.85, 0.08, 0); probe('vel', 16, 20, WORN, 0, 'default');
  state(IDX[4], 'vel', 20, 0, 0.85, 0.08, 0); probe('vel', 4, 20, WORN, 0, 'velocity H=4');
  state(IDX[0], 'vel', 20, 0, 0.85, 0.08, 0); probe('vel', 0, 20, WORN, 0, 'velocity whole course');
  state(IDX[16], 'abs', 20, 0, 0.85, 0.08, 0); probe('abs', 16, 20, WORN, 0, 'absolute H=16');
  state(IDX[1], 'abs', 20, 0, 0.85, 0.08, 0); probe('abs', 1, 20, WORN, 0, 'absolute H=1');
  state(IDX[0], 'abs', 20, 0, 0.85, 0.08, 0); probe('abs', 0, 20, WORN, 0, 'absolute whole course');
  state(IDX[2], 'rel', 20, 0, 0.85, 0.08, 0); probe('rel', 2, 20, WORN, 0, 'relative H=2');
  state(IDX[1], 'rel', 20, 0, 0.85, 0.08, 0); probe('rel', 1, 20, WORN, 0, 'relative H=1');
  state(IDX[8], 'rel', 20, 0, 0.85, 0.08, 0); probe('rel', 8, 20, WORN, 0, 'relative H=8');
  state(IDX[64], 'abs', 5, 0, 0.85, 0.08, 0); probe('abs', 64, 5, WORN, 0, 'soft K=5 H=64');
  state(IDX[1], 'abs', 5, 0, 0.85, 0.08, 0); probe('abs', 1, 5, WORN, 0, 'soft K=5 H=1');
  state(IDX[64], 'abs', 20, 2, 0.85, 0.08, 0); probe('abs', 64, 20, Object.assign({ delay: 2 }, WORN), 0, 'delay 2 K=20');
  state(IDX[64], 'abs', 15, 2, 0.85, 0.08, 0); probe('abs', 64, 15, Object.assign({ delay: 2 }, WORN), 0, 'delay 2 K=15');
  state(IDX[64], 'abs', 10, 2, 0.85, 0.08, 0); probe('abs', 64, 10, Object.assign({ delay: 2 }, WORN), 0, 'delay 2 K=10');
  state(IDX[16], 'vel', 20, 0, 1, 0.05, 0); probe('vel', 16, 20, NEW, 0, 'new arm velocity H=16');
  state(IDX[16], 'vel', 20, 0, 0.7, 0.08, 0); probe('vel', 16, 20, { gain: 0.7, noise: 0.08 }, 0, 'gain 0.7 velocity');
  state(IDX[16], 'abs', 20, 0, 0.7, 0.08, 0); probe('abs', 16, 20, { gain: 0.7, noise: 0.08 }, 0, 'gain 0.7 absolute');
  state(IDX[16], 'abs', 20, 0, 0.85, 0.08, 1); probe('abs', 16, 20, WORN, 1, 'shift +1 cm');
  state(IDX[16], 'abs', 20, 0, 0.85, 0.08, 2); probe('abs', 16, 20, WORN, 2, 'shift +2 cm');
  state(IDX[16], 'abs', 20, 0, 0.85, 0.08, -2); probe('abs', 16, 20, WORN, -2, 'shift -2 cm');
  // the sweep curves on the canvas are the same cells: spot-check the page's cache against the oracle through the readouts at other chunk lengths
  state(IDX[8], 'abs', 20, 0, 0.85, 0.08, 0); probe('abs', 8, 20, WORN, 0, 'absolute H=8');
  state(IDX[64], 'vel', 20, 0, 1, 0.05, 0); probe('vel', 64, 20, NEW, 0, 'new arm velocity H=64');
}

// every key the lesson quotes must be a finite number
for (const k of Object.keys(F)) if (!Number.isFinite(F[k])) { fail('fact ' + k + ' is not finite: ' + F[k]); }
const out = {}; for (const k of Object.keys(F)) out[k] = typeof F[k] === 'number' ? +F[k].toFixed(6) : F[k];
console.log(JSON.stringify({ facts: out }));
process.exit(bad ? 1 : 0);
