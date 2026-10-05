#!/usr/bin/env node
'use strict';
/* Oracle for robot_model_training lesson 13 (two clocks).
 * Re-derives every number the lesson quotes with code written separately from clock_lab.js: its own rollout (the plan in force at every step is found by a closed
 * form, not by scanning a list; dead reckoning uses prefix sums; the moved course is built by cloning), its own Wilson interval, its own cost model, its own
 * check of the delay-stability ceiling by simulating the recursion.  Only the world's primitives (arm, expert path, collision, random numbers) come from bench.js.
 * Then it drives the page's widget into every state the prose quotes and checks that what it prints is what the independent computation gives.
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
const r1 = (x) => +x.toFixed(1), r2 = (x) => +x.toFixed(2), r3 = (x) => +x.toFixed(3);

/* ───── the experiment, written out independently ───── */
const DT = 0.05, KTRACK = 0.5, VCLIP = 1.5, GUST = 0.05, SIZE = 0.07, LEAD0 = 0.08, LEAD1 = 0.16, POST = 2, NRUN = 300, SEED = 1;
const course = () => BN.slalom.world(5);
const sideOf = (w, k) => (k % 2 === 0 ? 1 : -1) * w.s0;
function vaseCourse(w, k, dy) {                                   // the same course with post k moved by dy and the expert's via point moved with it
  const posts = JSON.parse(JSON.stringify(w.posts)), via = JSON.parse(JSON.stringify(w.via));
  posts[k][1] += dy; via[k + 1][1] += dy;
  if (k === 0) via[0][1] += dy;
  if (k === w.n - 1) via[w.n + 1][1] += dy;
  return Object.assign({}, w, { posts, via });
}
const jointTarget = (w, x) => BN.arm.ik([x, BN.slalom.yref(w, x)], 1, w.body);
const wilson = (k, n) => { const z = 1.96, p = k / n, d = 1 + z * z / n, c = (p + z * z / (2 * n)) / d, h = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d; return [Math.max(0, c - h), Math.min(1, c + h)]; };

/* one run.  spec: design 'split' | 'loop' | 'alone', naive, L, K, H, event 'none' | 'vase' | 'shove', speed (m/s) */
function run(spec, i, seed) {
  const w = course(), T = Math.ceil(BN.slalom.horizon(w) * 0.15 / spec.speed), xe = BN.slalom.xEnd(w), x0 = BN.slalom.xStart(), vs = spec.speed * DT;
  const rng = BN.rng(1000 * seed + i + 1), re = BN.rng(7919 * seed + i + 3);
  const lead = LEAD0 + (LEAD1 - LEAD0) * re(), K = Math.max(1, spec.K), phase = Math.floor(re() * K);
  const L = spec.L, H = spec.H, side = sideOf(w, POST), px = w.posts[POST][0];
  const q = BN.slalom.startQ(w, 0.01 * BN.randn(rng)).slice();
  const Q = [q.slice()], U = [], cum = [[0, 0]];                 // joint history, commands applied, running sum of commands
  let world = w, moved = null, tFire = -1, c = 0, held = 0, coll = false, done = false, steps = T, lastWorld = w, lastC = 0, lag = NaN;
  const seenMoved = (s) => moved !== null && s >= tFire;           // did an observation taken at step s see the moved vase?
  for (let t = 0; t < T; t++) {
    const p = BN.arm.fk(q, w.body);
    if (BN.slalom.collide(world, p)) { coll = true; steps = t; break; }   // contact is judged against the course as it is at the start of the step
    if (p[0] > xe - 0.02) { done = true; steps = t; break; }
    if (spec.event === 'vase' && tFire < 0 && p[0] >= px - lead) {
      tFire = t; moved = vaseCourse(w, POST, side * SIZE); world = moved;
      lag = spec.design === 'loop' ? L : spec.design === 'alone' ? NaN : (phase + K * Math.ceil((t - phase) / K)) + L - t;   // first observation at or after the event, plus the latency
    }
    let tgt;
    if (spec.design === 'loop') {                                  // the model in the loop acts on the step t-L reading, plus the commands it has issued since
      const s = t - L, s0 = Math.max(0, s), seen = seenMoved(s) ? moved : w;
      const qhat = [Q[s0][0] + DT * (cum[t][0] - cum[s0][0]), Q[s0][1] + DT * (cum[t][1] - cum[s0][1])];
      if (spec.naive) { qhat[0] = Q[s0][0]; qhat[1] = Q[s0][1]; }
      c++; tgt = jointTarget(seen, x0 + vs * c);
      var u = [KTRACK / DT * (tgt[0] - qhat[0]), KTRACK / DT * (tgt[1] - qhat[1])];
    } else if (spec.design === 'alone') {
      c++; tgt = jointTarget(w, x0 + vs * c);
      var u = [KTRACK / DT * (tgt[0] - q[0]), KTRACK / DT * (tgt[1] - q[1])];
    } else {
      const s = phase + K * Math.floor((t - L - phase) / K);          // newest observation whose chunk has landed by step t
      if (t - s >= H) { held++; tgt = jointTarget(lastWorld, x0 + vs * lastC); }          // the chunk in force is used up: hold the last target
      else { lastWorld = seenMoved(s) ? moved : w; c++; lastC = c; tgt = jointTarget(lastWorld, x0 + vs * c); }
      var u = [KTRACK / DT * (tgt[0] - q[0]), KTRACK / DT * (tgt[1] - q[1])];
    }
    u = u.map((a) => Math.max(-VCLIP, Math.min(VCLIP, a))); U.push(u); cum.push([cum[t][0] + u[0], cum[t][1] + u[1]]);
    if (spec.event === 'shove' && tFire < 0 && p[0] >= px - lead) {
      tFire = t; lag = spec.design === 'loop' ? L : 0;
      const dq = BN.arm.dls(BN.arm.jac(q, w.body), [0, -side * SIZE], 1e-4); q[0] += dq[0]; q[1] += dq[1];
    }
    q[0] += DT * (u[0] + GUST * BN.randn(rng)); q[1] += DT * (u[1] + GUST * BN.randn(rng));
    Q.push(q.slice());
  }
  return { done, coll, steps, T, held, lag, tFire };
}
const cache = {};
function study(spec, n, seed) {
  const key = JSON.stringify([spec, n, seed]); if (cache[key]) return cache[key];
  let ok = 0, co = 0, held = 0, st = 0, lagS = 0, lagN = 0;
  for (let i = 0; i < n; i++) { const r = run(spec, i, seed); if (r.done) { ok++; st += r.steps; } if (r.coll) co++; held += r.held; if (!isNaN(r.lag)) { lagS += r.lag; lagN++; } }
  const ci = wilson(ok, n);
  return (cache[key] = { succ: ok / n * 100, coll: co / n * 100, to: (n - ok - co) / n * 100, ci: [ci[0] * 100, ci[1] * 100], held: held / n, steps: ok ? st / ok : NaN, lag: lagN ? lagS / lagN : NaN, n });
}
const S = (design, event, L, K, H, speed, extra) => study(Object.assign({ design, event, L, K, H, speed: speed || 0.15 }, extra || {}), NRUN, SEED);

/* ───── 1. the clock: what a reading d steps old does to a loop ───── */
function ceilingBySimulation(d) {                                  // largest k for which e(t+1) = e(t) - k e(t-d) does not grow: bisection on the amplitude late in a long run
  const grows = (k) => { const e = new Array(d + 1).fill(0); e[d] = 1; let w1 = 0, w2 = 0; for (let t = 0; t < 6000; t++) { const nx = e[d] - k * e[0]; e.shift(); e.push(nx); if (t >= 1000 && t < 1100) w1 = Math.max(w1, Math.abs(nx)); if (t >= 5900) w2 = Math.max(w2, Math.abs(nx)); if (Math.abs(nx) > 1e12) return true; } return w2 > w1; };
  let lo = 0, hi = 2.2; for (let it = 0; it < 40; it++) { const mid = (lo + hi) / 2; if (grows(mid)) hi = mid; else lo = mid; } return (lo + hi) / 2;
}
for (const d of [0, 1, 2, 3, 4, 6, 10]) {
  const formula = 2 * Math.sin(Math.PI / (4 * d + 2)), sim = ceilingBySimulation(d);
  F['ceil_d' + d] = r3(formula); check(Math.abs(sim - formula) < 0.02 * formula + 0.01, `ceiling for delay ${d}: simulation ${sim.toFixed(3)} vs formula ${formula.toFixed(3)}`);
}
F.k_track = KTRACK; F.k_track_ms = DT * 1000;
for (const L of [0, 1, 2, 3, 4, 6, 8]) { F['naive_L' + L + '_none'] = S('loop', 'none', L, 1, 99, 0.15, { naive: true }).succ; }
F.naive_L3_coll = S('loop', 'none', 3, 1, 99, 0.15, { naive: true }).coll;
F.naive_beyond_max = Math.max(...[10, 12, 16, 20].map((L) => S('loop', 'none', L, 1, 99, 0.15, { naive: true }).succ));   // past a delay of 8 the loop flails and now and then crosses by luck
for (const L of [0, 4, 8, 12, 20]) { F['comp_L' + L + '_none'] = S('loop', 'none', L, 1, 99).succ; }
// published decision times, in steps of 50 ms
F.ms_rt2_lo = Math.round(1000 / 3); F.ms_rt2_hi = 1000; F.fr_rt2_lo = r2(1000 / 3 / 50); F.fr_rt2_hi = r2(1000 / 50); F.ms_rt2_5b = 200; F.fr_rt2_5b = 200 / 50;
F.ms_openvla = Math.round(1000 / 6); F.fr_openvla = r2(1000 / 6 / 50); F.ms_pi0 = 14 + 32 + 27; F.fr_pi0 = r2(73 / 50); F.fr_pi0_50hz = r2(73 / 20);
F.ms_gemini = 250; F.fr_gemini = 250 / 50; F.ms_planner = 200 * 25 * 0.1; F.fr_planner = F.ms_planner / 50;
F.ms_pi0fast = 750; F.fr_pi0fast = 750 / 50;

/* ───── 2. the ruler ───── */
const FLOPS = 100e12, BW = 1e12, NTOK = 250, NOUT = 8;
const tRead = (P) => 2 * P * NTOK / FLOPS * 1000, tTok = (P) => 2 * P / BW * 1000;
for (const [name, P] of [['p045', 0.45e9], ['p3', 3e9], ['p7', 7e9]]) {
  F[name + '_read'] = r2(tRead(P)); F[name + '_tok'] = r2(tTok(P)); F[name + '_write'] = r2(NOUT * tTok(P)); F[name + '_tot'] = r2(tRead(P) + NOUT * tTok(P)); F[name + '_fr'] = r2((tRead(P) + NOUT * tTok(P)) / 50);
}
F.ruler_openvla_ratio = r2(F.ms_openvla / F.p7_tot);
{ const expertMs = 10 * Math.max(2 * 0.3e9 * 50 / FLOPS, 2 * 0.3e9 / BW) * 1000; F.flow_ms = r2(expertMs); F.pi0_obs_ratio = r2(32 / tRead(3e9)); F.pi0_flow_ratio = r2(27 / expertMs); F.pi0_ruler_ms = r1(tRead(3e9) + expertMs); }
for (const [name, tauMs] of [['50', 50], ['20', 20], ['5', 5], ['1', 1]]) F['pmax_' + name] = r3(tauMs / 1000 / (2 * NTOK / FLOPS + 2 * NOUT / BW) / 1e9);
F.pmax_50_feat = r2(0.05 * FLOPS / (2 * NTOK) / 1e9);

/* ───── 3. one model on one clock: the table at L = 6 ───── */
for (const ev of ['shove', 'vase', 'none']) {
  F['t3_naive_' + ev] = S('loop', ev, 6, 1, 99, 0.15, { naive: true }).succ; F['t3_loop_' + ev] = S('loop', ev, 6, 1, 99).succ;
  F['t3_alone_' + ev] = S('alone', ev, 6, 1, 99).succ; F['t3_split_' + ev] = S('split', ev, 6, 4, 12).succ;
}
F.acc_loop_6 = 6; F.acc_split_6_4 = Math.ceil(6 / 4); F.pass_loop = 20; F.pass_split_4 = 20 / 4;
F.t3_gap_vase = r1(F.t3_loop_vase - F.t3_split_vase);

/* ───── 4. the staleness rule ───── */
const Ls = [0, 1, 2, 3, 4, 6, 8, 10, 12, 16, 20];
const curve = (design, ev, K, H, speed, extra) => Ls.map((L) => S(design, ev, L, K, H, speed, extra).succ);
const cSplitShove = curve('split', 'shove', 4, 12), cLoopShove = curve('loop', 'shove', 1, 99), cSplitVase = curve('split', 'vase', 4, 12), cLoopVase = curve('loop', 'vase', 1, 99);
// with H = 12 the split starves for L > 8 (the widget's own curve shows it); the curves quoted in §3 and §5 use a chunk that is long enough at every L: H = L + K + 4
const cSplitShoveH = Ls.map((L) => S('split', 'shove', L, 4, L + 8).succ), cSplitVaseH = Ls.map((L) => S('split', 'vase', L, 4, L + 8).succ);
Ls.forEach((L, i) => { F['ssh_L' + L] = cSplitShoveH[i]; F['lsh_L' + L] = cLoopShove[i]; F['sva_L' + L] = cSplitVaseH[i]; F['lva_L' + L] = cLoopVase[i]; });
// the gap and the share of steps spent moving, no event, L = 4, K = 8
for (const H of [6, 8, 10, 12]) {
  const r = S('split', 'none', 4, 8, H); const mv = Math.min(1, Math.max(0, (H - 4) / 8));
  F['st_H' + H + '_succ'] = r.succ; F['st_H' + H + '_held'] = r1(r.held); F['st_H' + H + '_steps'] = isNaN(r.steps) ? 0 : r1(r.steps); F['st_H' + H + '_move'] = r3(mv); F['st_H' + H + '_gap'] = Math.max(0, 4 + 8 - H);
}
F.st_steps_free = r1(S('split', 'none', 4, 8, 12).steps);
F.st_move_meas_H10 = r3(1 - S('split', 'none', 4, 8, 10).held / S('split', 'none', 4, 8, 10).steps);
F.st_steps_pred_H10 = r1(F.st_steps_free / ((10 - 4) / 8));
for (const K of [1, 2, 4, 8]) { const r = S('split', 'vase', 4, K, 4 + K + 4); F['lag_K' + K] = r2(r.lag); F['lagpred_K' + K] = 4 + (K - 1) / 2; F['vaseK' + K] = r.succ; }
for (const K of [1, 4, 8, 16]) F['vaseK_' + K] = S('split', 'vase', 4, K, 4 + K + 4).succ;

/* ───── the widget's states ("What to try") ───── */
const ST = {};
const def = S('split', 'vase', 4, 4, 12); ST.def = def;
F.def_succ = def.succ; F.def_ci_lo = r1(def.ci[0]); F.def_ci_hi = r1(def.ci[1]); F.def_coll = def.coll; F.def_lag = r1(def.lag); F.def_lag_ms = Math.round(def.lag * 50); F.def_blind = r1(def.lag * DT * 0.15 * 100); F.def_steps = r1(def.steps); F.def_held = r1(def.held);
const shove = S('split', 'shove', 4, 4, 12); F.sh_succ = shove.succ; F.sh_lag = shove.lag;
const loopShove = S('loop', 'shove', 4, 1, 99), loopVase = S('loop', 'vase', 4, 1, 99), aloneVase = S('alone', 'vase', 4, 1, 99), aloneShove = S('alone', 'shove', 4, 1, 99);
F.lsh_4 = loopShove.succ; F.lva_4 = loopVase.succ; F.alv_4 = aloneVase.succ; F.als_4 = aloneShove.succ; F.lva_blind = r1(loopVase.lag * DT * 0.15 * 100);
const L10 = { ssh: S('split', 'shove', 10, 4, 18), sva: S('split', 'vase', 10, 4, 18), lsh: S('loop', 'shove', 10, 1, 99), lva: S('loop', 'vase', 10, 1, 99) };
F.L10_split_shove = L10.ssh.succ; F.L10_split_vase = L10.sva.succ; F.L10_loop_shove = L10.lsh.succ; F.L10_loop_vase = L10.lva.succ;
const K1 = S('split', 'vase', 4, 1, 12), K8 = S('split', 'vase', 4, 8, 16);
F.vaseK1 = K1.succ; F.vaseK8 = K8.succ; F.lagK8 = r1(K8.lag);
F.accK1 = 4; F.accK4 = 1; F.accK8 = 1; F.passK1 = 20; F.passK4 = 5; F.passK8 = 2.5;
for (const v of [0.10, 0.20, 0.30]) { const r = S('split', 'vase', 4, 4, 12, v); F['v' + Math.round(v * 100) + '_vase'] = r.succ; F['v' + Math.round(v * 100) + '_blind'] = r1(r.lag * DT * v * 100); }

/* ───── 5. deadlines ───── */
const d90 = (vals) => { for (let i = 1; i < vals.length; i++) if (vals[i] < 90 && vals[i - 1] >= 90) return Ls[i - 1] + (vals[i - 1] - 90) / (vals[i - 1] - vals[i]) * (Ls[i] - Ls[i - 1]); return NaN; };
for (const v of [0.10, 0.15, 0.20]) { const c = curve('loop', 'vase', 1, 99, v); const dd = d90(c); const tag = Math.round(v * 100); F['d90_' + tag] = r1(dd); F['d90cm_' + tag] = r1(dd * DT * v * 100); }
{ const cs = cLoopShove, dd = d90(cs); F.d90_shove = r1(dd); }
F.d90_split_age = r1(d90(cSplitVaseH) + 1.5);                      // the split's mean age at the event is L + 1.5 when K = 4
F.d90_split_L = r1(d90(cSplitVaseH)); F.d90cm_mean = r1((F.d90cm_10 + F.d90cm_15 + F.d90cm_20) / 3);
// ci_half_max: half-width of the 95 % interval of a cell of NRUN runs at its widest (a success rate of 50 %)
{ const W = BN.slalom.W;                                           // the constants of the course and of the two events, as the prose quotes them
  F.path_off_cm = r1(W.off * 100); F.clear_cm = r1((W.postR + W.grip) * 100); F.shove_cm = r1(SIZE * 100); F.shove_left_cm = r1(F.path_off_cm - F.shove_cm);
  F.lead_lo_cm = r1(LEAD0 * 100); F.lead_hi_cm = r1(LEAD1 * 100); F.lead_lo_s = r1(LEAD0 / 0.15); F.lead_hi_s = r1(LEAD1 / 0.15);
  F.horizon_steps = Math.ceil(BN.slalom.horizon(course()) * 0.15 / 0.15); F.nrun = NRUN; F.ci_half_max = r1(1.96 * Math.sqrt(0.25 / NRUN) * 100); F.shove_after2_cm = r2(SIZE * 100 * KTRACK * KTRACK); F.blind6 = r1(6 * DT * 0.15 * 100); }
F.deadline_ms = 333;
// real systems against the rule H >= L + K (all in steps of the robot's own clock)
F.pi0_L20 = r2(73 / 50); F.pi0_K20 = 16; F.pi0_need20 = r2(73 / 50 + 16); F.pi0_spare20 = r2(50 - (73 / 50 + 16));
F.pi0_L50 = r2(73 / 20); F.pi0_K50 = 25; F.pi0_need50 = r2(73 / 20 + 25); F.pi0_spare50 = r2(50 - (73 / 20 + 25));
F.pi0_exec20 = 32; F.pi0_exec50 = 50; F.gr_chunks_per_s = r1(1000 / 63.9); F.gr_actions_per_s = Math.round(16 * 1000 / 63.9);
F.helix_lo = Math.round(200 / 9); F.helix_hi = Math.round(200 / 7); F.helix_share = r2(80e6 / (7e9 + 80e6) * 100); F.pi0_expert_share = r1(0.3 / 3.3 * 100);
F.gem_min_chunk = 12.5; F.smol_span = r2(50 / 30);

/* ───── the interview prompt: 180 ms at 50 Hz, a look every 25 steps, a chunk of 50 ───── */
F.iv_L = 180 / 20; F.iv_need = F.iv_L + 25; F.iv_spare = 50 - F.iv_need;

/* ───── the checkpoint ───── */
{ const L = 4, K = 6, v = 0.2; F.ck_L = L; F.ck_K = K; F.ck_H = L + K; F.ck_age = L + (K - 1) / 2; F.ck_age_ms = F.ck_age * 50; F.ck_blind = r1(F.ck_age * DT * v * 100); F.ck_acc = Math.ceil(L / K); F.ck_acc_loop = L; F.ck_moving = r2((8 - L) / K); }

/* ───── claims of the prose, asserted ───── */
check(F.ceil_d0 > 1.99 && F.ceil_d1 === 1 && F.ceil_d3 < KTRACK && F.ceil_d2 > KTRACK, 'k = 0.5 sits below the ceiling at a delay of 2 and above it at 3');
check(F.naive_L2_none === 100 && [3, 4, 6, 8].every((L) => F['naive_L' + L + '_none'] === 0), 'the naive loop at k = 0.5 works to a delay of 2 and fails from 3, with nothing happening');
check(F.naive_L3_coll === 100 && F.naive_beyond_max < 30, 'the naive loop ends at a post in every run at a delay of 3, and flails (at most a quarter lucky) beyond 8');
check([0, 4, 8, 12, 20].every((L) => F['comp_L' + L + '_none'] >= 99), 'with dead reckoning the loop is stable at every delay when nothing happens');
check(cSplitShoveH.every((x) => x === 100) && aloneShove.succ === 100, 'the split and the fast loop alone survive every shove at every latency');
check(cLoopShove[0] === 100 && cLoopShove[Ls.indexOf(10)] < 60 && cLoopShove[Ls.indexOf(20)] < 35 && cLoopShove.every((x, i) => i === 0 || x <= cLoopShove[i - 1] + 3), 'the model in the loop loses shoves as its latency grows');
check(aloneVase.succ === 0 && S('alone', 'vase', 0, 1, 99).succ === 0, 'the fast loop alone never survives a moved vase');
check(cSplitVaseH.every((x, i) => i === 0 || x <= cSplitVaseH[i - 1] + 3) && cSplitVaseH[0] >= 95 && cSplitVaseH[Ls.length - 1] <= 5, 'vase success falls with latency for two clocks');
check(cLoopVase.every((x, i) => i === 0 || x <= cLoopVase[i - 1] + 3) && cLoopVase[0] === 100 && cLoopVase[Ls.length - 1] <= 5, 'vase success falls with latency for the model in the loop');
{ // the staleness cost of the split is (K-1)/2 steps: split at latency L matches the loop at latency L + 1.5 (interpolated)
  const interp = (c, x) => { for (let i = 1; i < Ls.length; i++) if (x <= Ls[i]) return c[i - 1] + (c[i] - c[i - 1]) * (x - Ls[i - 1]) / (Ls[i] - Ls[i - 1]); return c[Ls.length - 1]; };
  let worst = 0; for (const L of [2, 3, 4, 6, 8]) worst = Math.max(worst, Math.abs(cSplitVaseH[Ls.indexOf(L)] - interp(cLoopVase, L + 1.5))); F.stale_match_worst = r1(worst);
  check(worst < 8, 'two clocks at latency L behave like the loop at latency L + (K-1)/2 on vases (worst gap ' + worst.toFixed(1) + ' points)'); }
for (const K of [1, 2, 4, 8]) check(Math.abs(F['lag_K' + K] - F['lagpred_K' + K]) < 0.35, `mean delay before the vase is known: ${F['lag_K' + K]} vs ${F['lagpred_K' + K]} for K = ${K}`);
check(F.vaseK1 > F.vaseK_4 && F.vaseK_4 > F.vaseK_8 && F.vaseK_8 > F.vaseK_16 && F.vaseK_16 > 0, 'success on a moved vase falls as the decision interval grows');
check(F.st_H12_held === 0 && F.st_H10_held > 40 && F.st_H10_held < 55 && Math.abs(F.st_move_meas_H10 - 0.75) < 0.01 && Math.abs(F.st_steps_pred_H10 - F.st_H10_steps) < 1.5, 'a chunk shorter than L + K leaves a gap of L + K - H steps per cycle and the arm moves (H - L)/K of the time');
check(F.st_H8_succ === 0 && F.st_H6_succ === 0 && F.st_H10_succ === 100 && F.st_H12_succ === 100, 'below about 0.6 of the needed chunk the run times out');
check(F.d90cm_10 > 3 && F.d90cm_10 < 4.2 && F.d90cm_15 > 3 && F.d90cm_15 < 4.2 && F.d90cm_20 > 2.8 && F.d90cm_20 < 4.2, 'the stale-travel budget is about 3.5 cm at every speed up to 20 cm/s');
check(F.v30_vase < F.def_succ - 30 && F.v10_vase > F.def_succ, 'a faster arm shrinks the time budget in proportion');
check(F.t3_split_shove === 100 && F.t3_alone_shove === 100 && F.t3_alone_vase === 0 && F.t3_loop_shove < 90 && F.t3_loop_vase > F.t3_split_vase && F.t3_naive_none === 0, 'the table of one model on one clock');
check(Math.abs(F.ruler_openvla_ratio - 1.14) < 0.05 && F.pi0_obs_ratio > 1.5 && F.pi0_flow_ratio > 3, 'the ruler is a floor: close for a 7B reader, 2-4 times under for π0');

/* ───── the widget prints the same numbers ───── */
const html = path.join(root, dir, '13_anatomy_two_clocks.html');
if (fs.existsSync(html)) {
  const pg = loadPage(html);
  pg.problems.forEach((p) => fail('page problem: ' + p));
  const eqd = (id, want, digits, what) => { const got = pg.num(id); if (!(Math.abs(got - want) <= 0.5 * Math.pow(10, -digits) + 1e-9)) fail(`${what}: widget #${id} prints ${got}, independent computation gives ${Number(want).toFixed(digits + 2)}`); };
  const setState = (o) => { const m = Object.assign({ L: 4, K: 4, H: 12, v: 15, ev: 'vase', des: 'split' }, o); for (const k of ['L', 'K', 'H', 'v', 'ev', 'des']) if (pg.value('w13-' + k) !== String(m[k])) pg.set('w13-' + k, m[k]); };   // only the controls that differ: every set re-runs the 300 runs
  const probe = (r, tag, o) => {
    eqd('w13-succ', r.succ, 1, tag + ' success'); eqd('w13-coll', r.coll, 1, tag + ' collisions'); eqd('w13-to', r.to, 1, tag + ' timeouts');
    if (!isNaN(r.steps)) eqd('w13-time', r.steps, 1, tag + ' steps to the mat');
    eqd('w13-held', r.held, 1, tag + ' steps held');
    if (!isNaN(r.lag)) { eqd('w13-react', r.lag, 1, tag + ' reaction delay'); eqd('w13-blind', r.lag * DT * ((o && o.v) || 15), 1, tag + ' blind distance'); }
  };
  setState({}); probe(def, 'default'); eqd('w13-margin', 12 - (4 + 4), 0, 'margin'); eqd('w13-acc', 1, 0, 'accelerators'); eqd('w13-rate', 5, 1, 'passes per second');
  setState({ ev: 'shove' }); probe(shove, 'shove');
  setState({ ev: 'shove', des: 'loop' }); probe(loopShove, 'loop shove'); eqd('w13-acc', 4, 0, 'accelerators of the loop'); eqd('w13-rate', 20, 0, 'passes of the loop');
  setState({ ev: 'vase', des: 'loop' }); probe(loopVase, 'loop vase');
  setState({ ev: 'none', des: 'naive', L: 2 }); probe(S('loop', 'none', 2, 1, 99, 0.15, { naive: true }), 'naive L=2'); setState({ ev: 'none', des: 'naive', L: 3 }); probe(S('loop', 'none', 3, 1, 99, 0.15, { naive: true }), 'naive L=3'); eqd('w13-acc', 3, 0, 'copies of the naive loop');
  setState({ ev: 'shove', des: 'naive', L: 6 }); probe(S('loop', 'shove', 6, 1, 99, 0.15, { naive: true }), 'naive shove L=6');
  setState({ ev: 'vase', des: 'alone' }); probe(aloneVase, 'alone vase'); eqd('w13-acc', 0, 0, 'accelerators of the fast loop alone');
  setState({ ev: 'shove', des: 'alone' }); probe(aloneShove, 'alone shove');
  setState({ L: 10, H: 18, ev: 'shove' }); probe(L10.ssh, 'L=10 shove'); setState({ L: 10, H: 18, ev: 'vase' }); probe(L10.sva, 'L=10 vase');
  setState({ L: 10, ev: 'shove', des: 'loop' }); probe(L10.lsh, 'L=10 loop shove'); setState({ L: 10, ev: 'vase', des: 'loop' }); probe(L10.lva, 'L=10 loop vase');
  setState({ K: 1 }); probe(K1, 'K=1'); eqd('w13-acc', 4, 0, 'accelerators at K=1'); setState({ K: 8, H: 16 }); probe(K8, 'K=8'); eqd('w13-acc', 1, 0, 'accelerators at K=8'); eqd('w13-rate', 2.5, 1, 'passes at K=8');
  for (const H of [6, 8, 10, 12]) { setState({ K: 8, H, ev: 'none' }); probe(S('split', 'none', 4, 8, H), 'H=' + H); eqd('w13-margin', H - 12, 0, 'margin at H=' + H); }
  for (const v of [10, 20, 30]) { setState({ v }); probe(S('split', 'vase', 4, 4, 12, v / 100), 'speed ' + v, { v }); }
  setState({ L: 6, K: 4, H: 12, ev: 'vase', des: 'split' }); probe(S('split', 'vase', 6, 4, 12), 'L=6 vase'); eqd('w13-margin', 2, 0, 'margin at L=6');
  setState({ L: 8 }); probe(S('split', 'vase', 8, 4, 12), 'L=8 vase'); eqd('w13-margin', 0, 0, 'margin at L=8');     // "What to try": slide L to 6 and 8 at the default K = 4, H = 12
  if (Math.abs(S('split', 'vase', 8, 4, 12).succ - F.sva_L8) > 1e-9 || Math.abs(S('split', 'vase', 6, 4, 12).succ - F.sva_L6) > 1e-9) fail('the quoted sweeps (H = L + 8) differ from the widget at H = 12 where the margin is not negative');
}

console.log(JSON.stringify({ facts: F }));
process.exit(bad ? 1 : 0);
