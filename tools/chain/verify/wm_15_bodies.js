#!/usr/bin/env node
/* Oracle for World Models lesson 15, "Bodies, contact, and words".
 *
 * Three experiments, each re-derived here by a path that does not use the widget's code:
 *   WALL   one axis of the Courtyard.  A ball that touches a wall changes velocity inside one step.  The oracle re-implements the physics (a separate five-sub-step
 *          integrator, cross-checked against CY.step on the full 2-D world), rebuilds the log of launches from scratch (reading the touch label off the reflections inside the
 *          integrator rather than off the velocity residual), fits the smooth network with CY.MLP on its own arrays, fits the hybrid (touch-labelled modes, least-squares
 *          laws, a logistic switch solved by IRLS), and measures: error by distance to the wall, the width of the soft wall, a rollout through a bounce, the cost of the blur
 *          against the closed form h^2 w / 12 and of a misplaced switch against h^2 delta, the road not taken (training time, width, oversampling, more data).
 *   BLOCK  a block pushed over a rough table (Coulomb friction).  The step is checked against the closed form and against a fine Euler integration; the hidden-mode example;
 *          the camera's noise floor for a force (Monte Carlo against sqrt(6) sigma / dt^2); the 2 x 2 of {smooth, hybrid} x {camera, camera + touch}; the planner with words.
 *   DECOY  lesson 1's nudge task on the plain Courtyard, closed loop: exact simulator, hybrid, friction-only (no walls), six smooth networks; one-step RMS against success.
 * Finally the page's own widget is driven into the states the prose describes and must print the same numbers.  Prints {"facts": {...}} as its last line.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '../../../all_lessons');
const DIR = fs.existsSync(path.join(ROOT, 'world_models_new')) ? path.join(ROOT, 'world_models_new') : path.join(ROOT, 'world_models');
const CY = require(path.join(DIR, 'courtyard.js'));
const L15 = require(path.join(DIR, 'l15_contact.js'));
const { loadPage } = require('../dom_probe.js');

let fails = 0;
const facts = {};
function ok(name, cond, extra) { if (!cond) { fails++; console.error('FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); } }
const close = (a, b, tol) => Math.abs(a - b) <= (tol === undefined ? 1e-9 : tol);
const T0 = Date.now(); const lap = s => console.error(`[${((Date.now() - T0) / 1000).toFixed(1)} s] ${s}`);

/* ═══════════════════════════ 1. the physics of the wall, independently ═══════════════════════════ */
const GAMMA = 0.35, DT = 0.1, SUB = 5, RB = 0.1, EREST = 0.9, AW = 8, AH = 5;
const DEC = Math.exp(-GAMMA * DT), GLD = (1 - DEC) / GAMMA;
const LIM = { x: [RB, AW - RB], y: [RB, AH - RB] };
/* one axis, five sub-steps, counting reflections: returns [p', v', hits] with hits = +1 (upper wall) / -1 (lower wall) / 0 */
function stepWall(ax, p, v) {
  const h = DT / SUB, damp = Math.exp(-GAMMA * h), glide = (1 - damp) / GAMMA, lo = LIM[ax][0], hi = LIM[ax][1]; let hit = 0;
  for (let i = 0; i < SUB; i++) {
    p += v * glide; v *= damp;
    if (p < lo) { p = 2 * lo - p; v = -EREST * v; hit = -1; }
    if (p > hi) { p = 2 * hi - p; v = -EREST * v; hit = 1; }
  }
  return [p, v, hit];
}
{ // the five-sub-step integrator is CY.step, axis by axis, on random states of the FULL 2-D world (so the axes are independent)
  const rng = CY.rng(11), W = CY.world({ curtain: null }); let worst = 0;
  for (let n = 0; n < 600; n++) {
    let s = [0.2 + 7.6 * rng(), 0.2 + 4.6 * rng(), 8 * rng() - 4, 8 * rng() - 4], q = s.slice();
    for (let t = 0; t < 30; t++) {
      q = CY.step(W, q, null);
      const a = stepWall('x', s[0], s[2]), b = stepWall('y', s[1], s[3]); s = [a[0], b[0], a[1], b[1]];
    }
    for (let c = 0; c < 4; c++) worst = Math.max(worst, Math.abs(s[c] - q[c]));
  }
  ok('independent one-axis integrator == CY.step on the 2-D world (600 trajectories x 30 steps)', worst < 1e-9, worst);
  let w2 = 0; for (let n = 0; n < 300; n++) { const p = 0.2 + 7.6 * rng(), v = 8 * rng() - 4, a = stepWall('x', p, v), b = L15.axisStep('x', p, v); w2 = Math.max(w2, Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1])); }
  ok('L15.axisStep == the independent integrator', w2 < 1e-9, w2);
}
facts.decay = DEC; facts.glide = GLD;
{ // the jump: for a ball at speed v a distance d from the upper wall the step bounces iff d < G v; the velocity is D v or -e D v
  const v = 2, hi = LIM.x[1]; let dstar = null;
  for (let d = 0; d <= 0.6; d += 0.0001) { if (stepWall('x', hi - d, v)[2] === 1) { dstar = d; break; } }
  // scan upward from contact: first d with NO hit
  let dnoHit = null; for (let d = 0; d <= 0.6; d += 0.0001) { if (stepWall('x', hi - d, v)[2] !== 1) { dnoHit = d; break; } }
  ok('a step bounces iff d < G v (brute-force scan)', close(dnoHit, GLD * v, 2e-4), [dnoHit, GLD * v]);
  const below = stepWall('x', hi - (GLD * v - 0.002), v), above = stepWall('x', hi - (GLD * v + 0.002), v);
  ok('velocity after the step is D v away from the wall, -e D v when it bounces', close(above[1], DEC * v, 1e-12) && close(below[1], -EREST * DEC * v, 1e-12), [above[1], below[1]]);
  facts.v_ap = v; facts.d_star = GLD * v; facts.v_free = DEC * v; facts.v_bounce = -EREST * DEC * v; facts.jump_h = (1 + EREST) * DEC * v;
  facts.glide_cm = 100 * GLD; facts.decay_pct = 100 * (1 - DEC);
  // the line of discontinuity moves with the approach speed
  const d1 = (() => { for (let d = 0; d <= 0.9; d += 0.0001) if (stepWall('x', hi - d, 1)[2] !== 1) return d; })(), d3 = (() => { for (let d = 0; d <= 0.9; d += 0.0001) if (stepWall('x', hi - d, 3)[2] !== 1) return d; })();
  ok('the jump moves with speed: d* = G v at v = 1 and 3', close(d1, GLD, 3e-4) && close(d3, 3 * GLD, 3e-4), [d1, d3]);
  facts.d_star_1 = d1; facts.d_star_3 = d3;
}

/* ═══════════════════════════ 2. the log, rebuilt from scratch ═══════════════════════════ */
const WLOG = {};                                                                   // oracle's own log builder: reflection events give the touch label
function buildLog(nLaunch, seed) {
  const r = CY.rng(seed), W = CY.world({ curtain: null }), out = { x: [], y: [] };
  for (let i = 0; i < nLaunch; i++) {
    const s0 = CY.launch(W, r), an = 2 * Math.PI * r(), am = 3 * Math.sqrt(r()); let px = s0[0], py = s0[1], vx = s0[2], vy = s0[3];
    for (let t = 0; t < 93; t++) {
      if (t === 12) { vx += am * Math.cos(an); vy += am * Math.sin(an); }
      const a = stepWall('x', px, vx), b = stepWall('y', py, vy);
      out.x.push({ p: px, v: vx, p1: a[0], v1: a[1], c: a[2] }); out.y.push({ p: py, v: vy, p1: b[0], v1: b[1], c: b[2] });
      px = a[0]; vx = a[1]; py = b[0]; vy = b[1];
    }
  }
  return out;
}
const log1 = buildLog(60, 1), test2 = buildLog(300, 2);
{ const eng = L15.wallLog(60, 1); let same = eng.x.length === log1.x.length; if (same) for (let i = 0; i < eng.x.length; i++) { const a = eng.x[i], b = log1.x[i], c = eng.y[i], d = log1.y[i]; if (Math.abs(a.p - b.p) > 1e-12 || Math.abs(a.v1 - b.v1) > 1e-12 || a.c !== b.c || c.c !== d.c || Math.abs(c.v1 - d.v1) > 1e-12) { same = false; break; } }
  ok('the engine log == the oracle log (positions, velocities, touch labels, both axes)', same); }
const share = (log, ax) => log[ax].filter(s => s.c).length / log[ax].length;
facts.n_steps_train = log1.x.length; facts.n_launch_train = 60;
facts.n_contact_train = log1.x.filter(s => s.c).length; facts.contact_pct_train = 100 * share(log1, 'x');
facts.n_steps_test = test2.x.length; facts.n_contact_test = test2.x.filter(s => s.c).length; facts.contact_pct_test = 100 * share(test2, 'x');
{ // a bounce is one step in a log of ~93: how many steps does a launch spend near a wall? steps with the wall ahead within 0.5 m and speed > 0.3
  const near = test2.x.filter(s => Math.abs(s.v) > 0.3 && (s.v > 0 ? LIM.x[1] - s.p : s.p - LIM.x[0]) < 0.5).length;
  facts.near_pct_test = 100 * near / test2.x.length; facts.near_steps_test = near;
}

/* ═══════════════════════════ 3. the smooth network, on the oracle's arrays ═══════════════════════════ */
const AXC = { x: { mid: 4, half: 4 }, y: { mid: 2.5, half: 2.5 } };
function trainNet(ax, log, seed, opts) {
  opts = opts || {}; const H = opts.H || 12, net = new CY.MLP([2, H, H, 2], seed);
  let X = log.map(s => [(s.p - AXC[ax].mid) / AXC[ax].half, s.v / 3]), Y = log.map(s => [(s.p1 - s.p) / 0.5, s.v1 - s.v]);
  if (opts.oversample) { const extra = log.filter(s => s.c); for (let k = 1; k < opts.oversample; k++) extra.forEach(s => { X.push([(s.p - AXC[ax].mid) / AXC[ax].half, s.v / 3]); Y.push([(s.p1 - s.p) / 0.5, s.v1 - s.v]); }); }
  const stages = opts.stages || [[0.01, 40], [0.003, 40], [0.001, 40]]; let k = 0;
  stages.forEach(([lr, ep]) => { net.fit(X, Y, { epochs: ep, batch: 32, lr, seed: seed + 10 * k++ }); });
  return net;
}
const predNet = (ax, net) => (p, v) => { const o = net.predict([(p - AXC[ax].mid) / AXC[ax].half, v / 3]); return [p + 0.5 * o[0], v + o[1]]; };
const BINS = [[0, 0.1], [0.1, 0.2], [0.2, 0.3], [0.3, 0.5], [0.5, 1], [1, 99]];
function errors(pred, ax, log) {                                                    // oracle's own evaluation
  const bins = BINS.map(() => [0, 0]); let con = 0, nc = 0, tot = 0, n = 0, near = 0, nnear = 0, far = 0, nfar = 0; const med = [];
  for (const s of log) {
    const e = pred(s.p, s.v)[1] - s.v1; tot += e * e; n++;
    if (s.c) { con += e * e; nc++; med.push(Math.abs(e)); }
    if (Math.abs(s.v) > 0.3) {
      const d = s.v > 0 ? LIM[ax][1] - s.p : s.p - LIM[ax][0];
      BINS.forEach((b, i) => { if (d >= b[0] && d < b[1]) { bins[i][0] += e * e; bins[i][1]++; } });
      if (d < 0.5) { near += e * e; nnear++; } else if (d >= 1) { far += e * e; nfar++; }
    }
  }
  med.sort((a, b) => a - b);
  return { all: Math.sqrt(tot / n), contact: Math.sqrt(con / nc), shareContact: con / tot, medianContact: med[Math.floor(med.length / 2)], bins: bins.map(b => Math.sqrt(b[0] / b[1])), counts: bins.map(b => b[1]),
           near: Math.sqrt(near / nnear), nNear: nnear, far: Math.sqrt(far / nfar), shareNear: near / tot };
}
function width1090(pred, v) {                                                      // scanning from 0.9 m toward the wall; first d where the prediction has made 10 % / 90 % of the way to the bounce value
  const hi = LIM.x[1], top = DEC * v, bot = -EREST * DEC * v; let d10 = null, d90 = null;
  for (let d = 0.9; d >= -0.1; d -= 0.002) { const f = (top - pred(hi - d, v)[1]) / (top - bot); if (f > 0.1 && d10 === null) d10 = d; if (f > 0.9) { d90 = d; break; } }
  return d10 !== null && d90 !== null ? d10 - d90 : null;
}
function centre50(pred, v) {                                                       // where the prediction has made half of the way to the bounce value, minus the true edge G v (positive: the ramp sits on the free side of it)
  const hi = LIM.x[1], top = DEC * v, bot = -EREST * DEC * v;
  for (let d = 0.9; d >= -0.1; d -= 0.001) if ((top - pred(hi - d, v)[1]) / (top - bot) > 0.5) return d - GLD * v;
  return null;
}
lap('logs built');
const net3 = trainNet('x', log1.x, 3); lap('smooth net trained');
const smooth = predNet('x', net3);
{ const eng = new L15.WallNet('x', 3).trainStd(L15.wallLog(60, 1).x); let worst = 0; for (let k = 0; k < 400; k++) { const p = 0.2 + 7.6 * (k / 400), v = 6 * ((k * 7) % 400) / 400 - 3; const a = smooth(p, v), b = eng.pred(p, v); worst = Math.max(worst, Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1])); }
  ok('the engine network == the oracle network (same seeds, same arrays)', worst < 1e-12, worst); }
const eS = errors(smooth, 'x', test2.x);
facts.sm_all = eS.all; facts.sm_contact = eS.contact; facts.sm_median_contact = eS.medianContact; facts.sm_share_contact_pct = 100 * eS.shareContact;
facts.sm_near = eS.near; facts.sm_far = eS.far; facts.sm_near_far_ratio = eS.near / eS.far; facts.sm_contact_far_ratio = eS.contact / eS.far; facts.sm_share_near_pct = 100 * eS.shareNear;
eS.bins.forEach((b, i) => { facts['sm_bin' + i] = b; });
facts.n_near_test = eS.nNear;
facts.sm_width = width1090(smooth, 2);
ok('the soft wall is a ramp as wide as the bounce band itself (width between 12 and 30 cm)', facts.sm_width > 0.12 && facts.sm_width < 0.30, facts.sm_width);
ok('contact steps are a tiny share of the steps and a large share of the error', facts.contact_pct_test < 1 && facts.sm_share_contact_pct > 10, [facts.contact_pct_test, facts.sm_share_contact_pct]);
ok('near the wall the error is two orders of magnitude above the far-field error', facts.sm_near_far_ratio > 50, facts.sm_near_far_ratio);
{ // seeds: the width and the contact error do not depend on a lucky draw
  const w = [], c = [], nf = [], sn = [], cs = []; for (const sd of [3, 4, 5, 6, 7]) { const n = predNet('x', sd === 3 ? net3 : trainNet('x', log1.x, sd)); const e = errors(n, 'x', test2.x); w.push(width1090(n, 2)); c.push(e.contact); nf.push(e.near / e.far); sn.push(100 * e.shareNear); cs.push(100 * e.shareContact); }
  facts.sm_width_min = Math.min(...w); facts.sm_width_max = Math.max(...w); facts.sm_contact_min = Math.min(...c); facts.sm_contact_max = Math.max(...c);
  facts.sm_near_far_min = Math.min(...nf); facts.sm_near_far_max = Math.max(...nf); facts.sm_share_near_min = Math.min(...sn); facts.sm_share_near_max = Math.max(...sn);
  facts.sm_share_contact_min = Math.min(...cs); facts.sm_share_contact_max = Math.max(...cs);
  ok('the widget\'s network (seed 3) has the largest near/far ratio of the five seeds, and the near-wall steps carry 90 % or more of the squared error in every seed', close(facts.sm_near_far_ratio, facts.sm_near_far_max, 1e-9) && facts.sm_share_near_min > 90, [nf, sn]);
  ok('the bounce steps themselves carry well under all of the squared error (the subtitle must say "next to a wall", not "where something is touched")', facts.sm_share_contact_max < 80, cs);
  ok('every seed gives a soft wall wider than 12 cm', facts.sm_width_min > 0.12, w);
  lap('smooth seeds');
}
const SMLOG = [];                                                                  // the smooth network's one-step RMS on each of five training logs (for the comparison with the hybrid on the same log)
{ // different training logs (seeds 1..5), same network seed
  const w = []; for (const ls of [1, 2, 3, 4, 5]) { const lg = ls === 1 ? log1 : buildLog(60, ls), pn = predNet('x', ls === 1 ? net3 : trainNet('x', lg.x, 3)); w.push(width1090(pn, 2)); SMLOG.push(errors(pn, 'x', test2.x).all); }
  facts.sm_logs_width_min = Math.min(...w); facts.sm_logs_width_max = Math.max(...w); facts.sm_logs_all_min = Math.min(...SMLOG); facts.sm_logs_all_max = Math.max(...SMLOG); lap('smooth logs');
}

/* ═══════════════════════════ 4. a rollout through a bounce ═══════════════════════════ */
function roll(pred, p0, v0, T) { let p = p0, v = v0; const out = [[p, v]]; for (let t = 0; t < T; t++) { const o = pred(p, v); p = o[0]; v = o[1]; out.push([p, v]); } return out; }
const truthRoll = roll((p, v) => stepWall('x', p, v), LIM.x[1] - 1.0, 2.0, 16);
{
  const STEP = 10;                                                                  // look at step 10: four steps after the bounce
  facts.roll_step = STEP; facts.roll_truth_v = truthRoll[STEP][1]; facts.roll_truth_d = LIM.x[1] - truthRoll[STEP][0];
  const vs = [], ds = [];
  for (const sd of [3, 4, 5, 6]) { const n = predNet('x', sd === 3 ? net3 : trainNet('x', log1.x, sd)); const r = roll(n, LIM.x[1] - 1.0, 2.0, 16); vs.push(r[STEP][1]); ds.push(LIM.x[1] - r[STEP][0]); }
  facts.roll_sm_v_min = Math.min(...vs); facts.roll_sm_v_max = Math.max(...vs); facts.roll_sm_d_min = Math.min(...ds); facts.roll_sm_d_max = Math.max(...ds);
  ok('the true ball is going back at more than 1 m/s four steps after the bounce, every smooth model has (nearly) stopped it', facts.roll_truth_v < -1.0 && Math.abs(facts.roll_sm_v_min) < 0.5 && Math.abs(facts.roll_sm_v_max) < 0.5, [facts.roll_truth_v, vs]);
  lap('rollouts');
}

/* ═══════════════════════════ 5. the hybrid: touch-labelled modes, linear laws, a logistic switch ═══════════════════════════ */
function lsq(rows, ys) {                                                            // normal equations, own solver
  const p = rows[0].length, q = ys[0].length, A = new Float64Array(p * p), Bm = new Float64Array(p * q);
  rows.forEach((r, i) => { for (let a = 0; a < p; a++) { for (let b = 0; b < p; b++) A[a * p + b] += r[a] * r[b]; for (let c = 0; c < q; c++) Bm[a * q + c] += r[a] * ys[i][c]; } });
  for (let a = 0; a < p; a++) A[a * p + a] += 1e-9;
  return CY.la.solve(A, Bm, p);
}
function irls(Z, y, lam) {                                                          // logistic regression by iteratively reweighted least squares (a different formulation from the engine's Newton step)
  const n = Z.length, d = Z[0].length; let w = new Array(d).fill(0);
  for (let it = 0; it < 80; it++) {
    const A = new Float64Array(d * d), b = new Float64Array(d); let moved = 0;
    for (let i = 0; i < n; i++) {
      let t = 0; for (let k = 0; k < d; k++) t += w[k] * Z[i][k];
      const p = 1 / (1 + Math.exp(-t)), W = Math.max(p * (1 - p), 1e-9), z = t + (y[i] - p) / W;       // working response
      for (let a = 0; a < d; a++) { b[a] += W * Z[i][a] * z; for (let c = 0; c < d; c++) A[a * d + c] += W * Z[i][a] * Z[i][c]; }
    }
    for (let a = 1; a < d; a++) A[a * d + a] += lam; A[0] += 1e-9;
    const wn = CY.la.solve(A, b, d); for (let k = 0; k < d; k++) { moved = Math.max(moved, Math.abs(wn[k] - w[k])); w[k] = wn[k]; }
    if (moved < 1e-9) break;
  }
  return w;
}
function fitHybrid(ax, log, lam) {
  const c = AXC[ax], laws = {};
  [0, 1, -1].forEach(m => { const S = log.filter(s => s.c === m); laws[m] = S.length >= 3 ? lsq(S.map(s => [1, s.p, s.v]), S.map(s => [s.p1, s.v1])) : null; });
  const Z = log.map(s => [1, (s.p - c.mid) / c.half, s.v / 3]);
  const wu = irls(Z, log.map(s => s.c === 1 ? 1 : 0), lam), wd = irls(Z, log.map(s => s.c === -1 ? 1 : 0), lam);
  const mode = (p, v) => { const z = [1, (p - c.mid) / c.half, v / 3], su = wu[0] * z[0] + wu[1] * z[1] + wu[2] * z[2], sd = wd[0] * z[0] + wd[1] * z[1] + wd[2] * z[2]; return su > 0 ? 1 : (sd > 0 ? -1 : 0); };
  const pred = (p, v) => { const L = laws[mode(p, v)] || laws[0]; return [L[0] + L[2] * p + L[4] * v, L[1] + L[3] * p + L[5] * v]; };
  const boundary = v => { for (let d = 0.8; d >= 0; d -= 0.0005) if (mode(LIM[ax][1] - d, v) === 1) return d; return null; };
  return { laws, mode, pred, boundary, wu, wd };
}
const hyb = fitHybrid('x', log1.x, 1e-5);
{ const eng = new L15.WallHybrid('x', L15.wallLog(60, 1).x); let worst = 0; for (let k = 0; k < 600; k++) { const p = 0.2 + 7.6 * (k / 600), v = 8 * ((k * 13) % 600) / 600 - 4, a = hyb.pred(p, v), b = eng.pred(p, v); worst = Math.max(worst, Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1])); }
  ok('the engine hybrid == the oracle hybrid (IRLS vs Newton, own least squares vs ridge)', worst < 1e-3, worst); }
{ // the laws are the physics: free flight p' = p + G v, v' = D v; a bounce v' = -e D v
  const L0 = hyb.laws[0], Lu = hyb.laws[1];
  ok('free-flight law fitted from the log: v\' = D v and p\' = p + G v', close(L0[5], DEC, 1e-8) && close(L0[4], GLD, 1e-8) && close(L0[2], 1, 1e-8) && Math.abs(L0[1]) < 1e-7 && Math.abs(L0[0]) < 1e-7, L0);
  ok('bounce law fitted from the touch-labelled steps: v\' = -e D v', close(Lu[5], -EREST * DEC, 1e-8), Lu[5]);
  facts.law_free_decay = L0[5]; facts.law_bounce_gain = Lu[5]; facts.law_bounce_gain_true = -EREST * DEC;
}
const eH = errors(hyb.pred, 'x', test2.x);
facts.hy_all = eH.all; facts.hy_contact = eH.contact; facts.hy_median_contact = eH.medianContact; facts.hy_near = eH.near; facts.hy_far = eH.far;
eH.bins.forEach((b, i) => { facts['hy_bin' + i] = b; });
{ let wrong = 0; for (const s of test2.x) if (hyb.mode(s.p, s.v) !== s.c) wrong++;
  facts.hy_wrong = wrong; facts.hy_wrong_per10k = 1e4 * wrong / test2.x.length;
  facts.hy_delta_mm = 1000 * Math.abs(hyb.boundary(2) - GLD * 2); facts.hy_delta1_mm = 1000 * Math.abs(hyb.boundary(1) - GLD); facts.hy_delta3_mm = 1000 * Math.abs(hyb.boundary(3) - 3 * GLD);
  ok('the hybrid places the wall within 2 cm at 1, 2 and 3 m/s and mislabels fewer than 5 in 10,000 steps', Math.max(facts.hy_delta_mm, facts.hy_delta1_mm, facts.hy_delta3_mm) < 20 && facts.hy_wrong_per10k < 5, [facts.hy_delta_mm, facts.hy_delta1_mm, facts.hy_delta3_mm, facts.hy_wrong]);
  // the same logistic fit, nearly unregularised vs strongly regularised
  const hl = fitHybrid('x', log1.x, 1e-3); let w3 = 0; for (const s of test2.x) if (hl.mode(s.p, s.v) !== s.c) w3++;
  facts.hy_wrong_lam3 = w3; facts.hy_all_lam3 = errors(hl.pred, 'x', test2.x).all; facts.hy_delta_lam3_mm = 1000 * Math.abs(hl.boundary(2) - GLD * 2);
  ok('with a strong ridge the switch is off by centimetres and the one-step RMS is no better than the smooth network\'s', facts.hy_all_lam3 > 0.6 * facts.sm_all, [facts.hy_all_lam3, facts.sm_all]);
}
ok('the hybrid is exact where it matters: the median contact step has error < 1e-10 m/s and the smooth network\'s is above 0.1', facts.hy_median_contact < 1e-10 && facts.sm_median_contact > 0.1, [facts.hy_median_contact, facts.sm_median_contact]);
ok('the hybrid RMS over all steps is below the smooth network\'s', facts.hy_all < facts.sm_all, [facts.hy_all, facts.sm_all]);
facts.rms_ratio_sm_hy = facts.sm_all / facts.hy_all;
{ // seeds of the training log: range of the hybrid's wrong-mode count and RMS
  const wr = [], al = [], dl = []; for (const ls of [1, 2, 3, 4, 5]) { const lg = ls === 1 ? log1 : buildLog(60, ls), h = fitHybrid('x', lg.x, 1e-5); let w = 0; for (const s of test2.x) if (h.mode(s.p, s.v) !== s.c) w++; wr.push(w); al.push(errors(h.pred, 'x', test2.x).all); dl.push(1000 * Math.abs(h.boundary(2) - 2 * GLD)); }
  ok('on each of the five logs the hybrid has a lower one-step RMS than the smooth network trained on the same log', al.every((x, i) => x < SMLOG[i]), [al, SMLOG]); facts.hy_logs_wrong_min = Math.min(...wr); facts.hy_logs_wrong_max = Math.max(...wr); facts.hy_logs_all_min = Math.min(...al); facts.hy_logs_all_max = Math.max(...al); facts.hy_logs_delta_max = Math.max(...dl); facts.hy_logs_delta_min = Math.min(...dl);
  ok('the hybrid places the edge within w/12 (23 mm) of the truth on every one of the five logs', facts.hy_logs_delta_max < 1000 * (facts.sm_width / 0.8) / 12, dl);
  lap('hybrid logs');
}
{ // the price of a blur against the price of a misplaced switch, at 2 m/s: integral over the distance to the wall of the squared velocity error
  const hi = LIM.x[1]; const energy = pred => { let s = 0; for (let d = 0; d <= 0.8; d += 0.0005) { const e = pred(hi - d, 2)[1] - stepWall('x', hi - d, 2)[1]; s += e * e * 0.0005; } return s; };
  facts.energy_sm = energy(smooth); facts.energy_hy = energy(hyb.pred);
  const wRamp = facts.sm_width / 0.8; facts.energy_sm_formula = facts.jump_h * facts.jump_h * wRamp / 12; facts.energy_hy_formula = facts.jump_h * facts.jump_h * Math.abs(hyb.boundary(2) - GLD * 2);
  facts.energy_ratio = facts.energy_sm / facts.energy_hy;
  ok('blur energy ~ h^2 w / 12 (within a factor 2)', facts.energy_sm / facts.energy_sm_formula > 0.5 && facts.energy_sm / facts.energy_sm_formula < 2, [facts.energy_sm, facts.energy_sm_formula]);
  ok('misplaced-switch energy = h^2 delta (within 15 %)', Math.abs(facts.energy_hy / facts.energy_hy_formula - 1) < 0.15, [facts.energy_hy, facts.energy_hy_formula]);
  facts.delta_over_w = Math.abs(hyb.boundary(2) - GLD * 2) / facts.sm_width;
}

/* ═══════════════════════════ 6. the road not taken: more training, a wider network, oversampling, more data ═══════════════════════════ */
{
  const road = {};
  road.ep120 = facts.sm_width;
  { // continuation of the same network at lr 0.002 for 120 more epochs, five times
    const net = trainNet('x', log1.x, 3), X = log1.x.map(s => [(s.p - 4) / 4, s.v / 3]), Y = log1.x.map(s => [(s.p1 - s.p) / 0.5, s.v1 - s.v]);
    const ws = []; for (let k = 0; k < 5; k++) { net.fit(X, Y, { epochs: 120, batch: 32, lr: 0.002, seed: 3 + 30 + 10 * k }); ws.push(width1090(predNet('x', net), 2)); if (k === 0) road.ep240 = ws[0]; if (k === 2) { road.ep480 = ws[2]; road.near480 = errors(predNet('x', net), 'x', test2.x).near; } if (k === 4) { road.ep720 = ws[4]; const e = errors(predNet('x', net), 'x', test2.x); road.near720 = e.near; road.contact720 = e.contact; road.all720 = e.all; } }
    lap('road: continuation');
  }
  { const n32 = trainNet('x', log1.x, 3, { H: 32 }); road.h32 = width1090(predNet('x', n32), 2); const e = errors(predNet('x', n32), 'x', test2.x); road.h32_near = e.near; road.h32_all = e.all; lap('road: H=32'); }
  { const nx = trainNet('x', log1.x, 3, { oversample: 20 }); const e = errors(predNet('x', nx), 'x', test2.x); road.x20 = width1090(predNet('x', nx), 2); road.x20_off = centre50(predNet('x', nx), 2); road.x20_contact = e.contact; road.x20_near = e.near; road.x20_bins = e.bins; road.x20_all = e.all; lap('road: oversampling'); }
  { const big = buildLog(240, 1); const nb = trainNet('x', big.x, 3, { stages: [[0.01, 20], [0.003, 20], [0.001, 20]] }); const e = errors(predNet('x', nb), 'x', test2.x); road.big = width1090(predNet('x', nb), 2); road.big_near = e.near; road.big_all = e.all; road.big_ncontact = big.x.filter(s => s.c).length; lap('road: 4x data'); }
  Object.keys(road).forEach(k => { if (typeof road[k] === 'number') facts['road_' + k] = road[k]; });
  facts.road_x20_bin1 = road.x20_bins[1]; facts.road_x20_bin2 = road.x20_bins[2];
  ok('training six times longer narrows the soft wall but not below 10 cm', road.ep720 < road.ep120 && road.ep720 > 0.10, [road.ep120, road.ep720]);
  ok('a wider network does not narrow it', road.h32 > 0.8 * road.ep120, [road.h32, road.ep120]);
  ok('oversampling the contact steps twentyfold narrows the ramp, the error just before the wall stays above 0.3 m/s', road.x20_bins[1] > 0.3 || road.x20_bins[2] > 0.3, road.x20_bins);
  ok('four times the data narrows it only a little', road.big > 0.10 && road.big < road.ep120 * 1.05, [road.big, road.ep120]);
  facts.sm_off = centre50(smooth, 2);
  ok('the oversampled network\'s ramp is narrower and sits further past the true edge than the first network\'s (the misplaced step costs more than the gentle ramp), and the wider network\'s 21 cm is inside the seed spread of the first one',
     road.x20 < facts.sm_width && road.x20_off > facts.sm_off && facts.sm_off > 0 && road.x20_near > facts.sm_near && road.h32 >= facts.sm_width_min, [road.x20, road.x20_off, facts.sm_off, road.h32, facts.sm_width_min]);
}

/* ═══════════════════════════ 7. the block, independently ═══════════════════════════ */
const G0 = 9.81, DTB = 0.05, MUS = 0.5, MUK = 0.3, FMAX = 12, TP = 6;
const MASS = { A: 1, B: 2 };
/* the exact step written another way: time to stop, then the remainder at rest */
function stepC(m, x, v, F) {
  const Fs = MUS * m * G0, Fk = MUK * m * G0;
  if (v === 0 && F <= Fs) return [x, 0, F];
  const a = (F - Fk) / m;                                                             // acceleration once it slides (the friction opposes the motion; the push is to the right)
  const tStop = a < 0 ? v / -a : Infinity, t = Math.min(DTB, tStop);                  // time spent sliding inside this step
  return [x + v * t + 0.5 * a * t * t, tStop <= DTB ? 0 : v + a * DTB, Fk];
}
function closedFinal(m, F, Tp) {                                                      // push for Tp steps, release; distance when it stops
  const Fs = MUS * m * G0, Fk = MUK * m * G0; if (F <= Fs) return 0;
  const a = (F - Fk) / m, T = Tp * DTB, v1 = a * T, coast = v1 * v1 / (2 * MUK * G0);
  return 0.5 * a * T * T + coast;
}
function eulerFinal(m, F, Tp) {                                                       // a fine forward-Euler integration of the physics, no formulas from the lesson
  const h = 1e-4, Fs = MUS * m * G0, Fk = MUK * m * G0; let x = 0, v = 0, t = 0;
  for (let k = 0; k < 40 / h; k++) {
    const f = t < Tp * DTB ? F : 0;
    if (v <= 0 && Math.abs(f) <= Fs) { v = 0; } else { const a = (f - Fk) / m; v += a * h; if (v < 0) v = 0; x += v * h; }
    t += h;
  }
  return x;
}
{
  let w1 = 0, w2 = 0, w3 = 0;
  for (const m of [1, 2]) for (let F = 0; F <= 14; F += 0.37) for (const Tp of [3, 6, 10]) {
    const tr = L15.blockPush(m, F, Tp, 400); w1 = Math.max(w1, Math.abs(tr.X[tr.X.length - 1] - closedFinal(m, F, Tp)), Math.abs(L15.blockFinal(m, F, Tp) - closedFinal(m, F, Tp)));
  }
  const rng = CY.rng(5); for (let n = 0; n < 2000; n++) { const m = 1 + rng(), x = rng(), v = rng() < 0.3 ? 0 : 2 * rng(), F = 14 * rng(), a = stepC(m, x, v, F), b = L15.blockStep(m, x, v, F); for (let k = 0; k < 3; k++) w2 = Math.max(w2, Math.abs(a[k] - b[k])); }
  for (const [m, F, Tp] of [[1, 6, 6], [1, 8, 6], [2, 11, 6], [2, 9.9, 6], [1, 4.5, 6], [1, 12, 6]]) w3 = Math.max(w3, Math.abs(eulerFinal(m, F, Tp) - closedFinal(m, F, Tp)));
  ok('the engine stepper reproduces the closed form of "push, release, slide" (stick below mu_s N, breakaway, slide, stop)', w1 < 1e-9, w1);
  ok('the engine stepper == the time-to-stop formulation on 2000 random states', w2 < 1e-12, w2);
  ok('the closed form agrees with a 0.1 ms Euler integration to 2 mm', w3 < 2e-3, w3);
}
facts.Fs_A = MUS * 1 * G0; facts.Fk_A = MUK * 1 * G0; facts.Fs_B = MUS * 2 * G0; facts.Fk_B = MUK * 2 * G0;
facts.drop_A = facts.Fs_A - facts.Fk_A; facts.drop_B = facts.Fs_B - facts.Fk_B;
facts.jump_A = closedFinal(1, facts.Fs_A + 1e-9, TP); facts.jump_B = closedFinal(2, facts.Fs_B + 1e-9, TP); facts.below_A = closedFinal(1, facts.Fs_A, TP);
facts.max_A = closedFinal(1, FMAX, TP); facts.max_B = closedFinal(2, FMAX, TP);
ok('the jump at breakaway is the same for the two blocks (it depends on F / N only)', close(facts.jump_A, facts.jump_B, 1e-6), [facts.jump_A, facts.jump_B]);
facts.v_break = (MUS - MUK) * G0 * DTB;                                               // the velocity after the first step of a breakaway at F = mu_s N
ok('one step of breakaway at F = mu_s N gives v = (mu_s - mu_k) g dt', close(L15.blockStep(1, 0, 0, facts.Fs_A + 1e-9)[1], facts.v_break, 1e-6));
{ // the hidden mode: the same push on a block at rest and on one that is moving 1 mm/s
  const F = 4.0; facts.bi_F = F; facts.bi_rest = L15.blockStep(1, 0, 0, F)[1]; facts.bi_move = L15.blockStep(1, 0, 0.001, F)[1];
  ok('at 4 N a block at rest stays at rest and a block moving at 1 mm/s speeds up', facts.bi_rest === 0 && facts.bi_move > 0.05, [facts.bi_rest, facts.bi_move]);
  facts.bi_gap_mm = 1000 * facts.bi_move;
  // the push that keeps a moving block sliding is smaller than the push that starts it
  facts.hyst_band = facts.Fs_A - facts.Fk_A;
}
{ // what a camera can see of a force: velocity from two readings, acceleration from three
  const SX = 0.002, rr = CY.rng(41); let sv = 0, sa = 0; const n = 200000, aTrue = 1.3;
  for (let i = 0; i < n; i++) { const x0 = SX * CY.randn(rr), x1 = 0.5 * aTrue * DTB * DTB + SX * CY.randn(rr), x2 = 0.5 * aTrue * 4 * DTB * DTB + SX * CY.randn(rr); const v = (x1 - x0) / DTB, a = (x2 - 2 * x1 + x0) / (DTB * DTB); sv += (v - aTrue * DTB / 2) ** 2; sa += (a - aTrue) ** 2; }
  facts.sx_mm = 1000 * SX; facts.dtb_ms = 1000 * DTB; facts.sig_v = Math.SQRT2 * SX / DTB; facts.sig_a = Math.sqrt(6) * SX / (DTB * DTB); facts.sig_F_A = 1 * facts.sig_a; facts.sig_F_B = 2 * facts.sig_a;
  ok('velocity from two camera readings has error sqrt(2) sigma / dt (Monte Carlo)', close(Math.sqrt(sv / n), facts.sig_v, 0.0015), [Math.sqrt(sv / n), facts.sig_v]);
  ok('acceleration from three readings has error sqrt(6) sigma / dt^2 (Monte Carlo)', close(Math.sqrt(sa / n), facts.sig_a, 0.02), [Math.sqrt(sa / n), facts.sig_a]);
  facts.sig_F_over_drop_A = facts.sig_F_A / facts.drop_A; facts.sig_F_over_Fs_A = facts.sig_F_A / facts.Fs_A;
}

/* the log, the models: rebuilt on the oracle's arrays */
function buildBlockLog(nPer, seed) {
  const r = CY.rng(seed), S = [];
  for (let e = 0; e < nPer * 2; e++) {
    const blk = e % 2 === 0 ? 'A' : 'B', m = MASS[blk], F = FMAX * r(), Tp = 3 + Math.floor(8 * r()); let x = 0, v = 0;
    for (let t = 0; t < 40; t++) { const Fa = t < Tp ? F : 0, o = stepC(m, x, v, Fa); S.push({ blk, N: m * G0, v, F: Fa, dv: o[1] - v, dx: o[0] - x, f: o[2], slip0: v > 0 ? 1 : 0, slip1: o[1] > 0 ? 1 : 0 }); x = o[0]; v = o[1]; }
  }
  return S;
}
const blog = buildBlockLog(30, 1), btest = buildBlockLog(100, 2);
{ const eng = L15.blockLog(30, 1); let same = eng.length === blog.length; if (same) for (let i = 0; i < eng.length; i++) if (eng[i].blk !== blog[i].blk || Math.abs(eng[i].dv - blog[i].dv) > 1e-12 || Math.abs(eng[i].F - blog[i].F) > 1e-12 || eng[i].slip1 !== blog[i].slip1) { same = false; break; }
  ok('the engine block log == the oracle block log', same); }
facts.blk_n_train = blog.length; facts.blk_n_episodes = 60;
facts.blk_stuck_pct = 100 * blog.filter(s => !s.slip0).length / blog.length; facts.blk_switch_pct = 100 * blog.filter(s => s.slip0 !== s.slip1).length / blog.length;
function trainBlockNet(touch, seed) {
  const net = new CY.MLP([touch ? 3 : 2, 12, 12, 3], seed), fe = s => touch ? [s.v / 1.5, s.F / 7, s.N / 20] : [s.v / 1.5, s.F / 7];
  const X = blog.map(fe), Y = blog.map(s => [s.dv / 0.5, s.dx / 0.05, s.f / 7]);
  [0.01, 0.003, 0.001].forEach((lr, i) => net.fit(X, Y, { epochs: 20, batch: 32, lr, seed: seed + i }));
  return { step: (blk, x, v, F) => { const o = net.predict(fe({ v, F, N: MASS[blk] * G0 })); return [x + o[1] * 0.05, Math.max(0, v + o[0] * 0.5), o[2] * 7]; } };
}
function fitBlockHybrid(touch, thr, lg) {
  lg = lg || blog;
  const q = s => touch ? s.F / s.N : s.F, sc = touch ? 2 : 0.2, slip = lg.filter(s => s.slip0 && s.slip1), stuck = lg.filter(s => !s.slip0);
  const law = lsq(slip.map(s => [1, s.v, q(s)]), slip.map(s => [s.dv, s.dx, touch ? s.f / s.N : s.f]));
  const wz = irls(stuck.map(s => [1, q(s) * sc, 0]).map(z => [z[0], z[1]]), stuck.map(s => s.slip1), 1e-4);
  const pStart = qq => 1 / (1 + Math.exp(-(wz[0] + wz[1] * qq * sc)));
  return { law, pStart, theta: -wz[0] / (wz[1] * sc), sharp: wz[1] * sc, step: (blk, x, v, F) => { const qq = touch ? F / (MASS[blk] * G0) : F; if (v === 0 && pStart(qq) < thr) return [x, 0, F]; const dv = law[0] + law[3] * v + law[6] * qq, dx = law[1] + law[4] * v + law[7] * qq, f = law[2] + law[5] * v + law[8] * qq; return [x + dx, Math.max(0, v + dv), touch ? f * MASS[blk] * G0 : f]; } };
}
const roll1 = (model, blk, F, Tp) => { let x = 0, v = 0; for (let t = 0; t < 60; t++) { const o = model.step(blk, x, v, t < Tp ? F : 0); x = o[0]; v = o[1]; } return x; };
const BM = { sc: trainBlockNet(false, 3), st: trainBlockNet(true, 3), hc: fitBlockHybrid(false, 0.9), ht: fitBlockHybrid(true, 0.9) };
const NT = [3, 4, 5, 6, 7, 8, 9, 10].map(sd => sd === 3 ? BM.st : trainBlockNet(true, sd)), NC = [3, 4, 5, 6, 7, 8, 9, 10].map(sd => sd === 3 ? BM.sc : trainBlockNet(false, sd));   // eight seeds of the smooth block models (the widget shows the first)
lap('block models');
{ // the engine's models agree with the oracle's
  const eSmooth = [false, true].map(t => new L15.BlockSmooth(t, 3).train(L15.blockLog(30, 1))), eHyb = [false, true].map(t => new L15.BlockHybrid(t, L15.blockLog(30, 1)));
  let worst = 0;
  for (let F = 0; F <= 12; F += 0.5) for (const b of ['A', 'B']) for (const [em, om] of [[eSmooth[0], BM.sc], [eSmooth[1], BM.st], [eHyb[0], BM.hc], [eHyb[1], BM.ht]]) worst = Math.max(worst, Math.abs(L15.blockFinalModel(em, b, F, TP) - roll1(om, b, F, TP)));
  ok('engine block models == oracle block models (final distances over a force sweep)', worst < 1e-6, worst);
}
{ // what the finger will feel: the predicted friction force against the true one, one step ahead, on a held-out log; the engine models agree with the oracle's
  const rmsF = model => { let e = 0; for (const s of btest) { const o = model.step(s.blk, 0, s.v, s.F); e += (o[2] - s.f) ** 2; } return Math.sqrt(e / btest.length); };
  facts.feel_sc = rmsF(BM.sc); facts.feel_st = rmsF(BM.st); facts.feel_hc = rmsF(BM.hc); facts.feel_ht = rmsF(BM.ht);
  const eng = { sc: new L15.BlockSmooth(false, 3).train(L15.blockLog(30, 1)), st: new L15.BlockSmooth(true, 3).train(L15.blockLog(30, 1)), hc: new L15.BlockHybrid(false, L15.blockLog(30, 1)), ht: new L15.BlockHybrid(true, L15.blockLog(30, 1)) };
  let worst = 0; for (const s of btest.slice(0, 600)) for (const k of Object.keys(eng)) worst = Math.max(worst, Math.abs(eng[k].step(s.blk, 0, s.v, s.F)[2] - BM[k].step(s.blk, 0, s.v, s.F)[2]));
  ok('engine block models == oracle block models in the predicted friction force', worst < 1e-6, worst);
  ok('with touch the hybrid predicts the force the finger feels to a few hundredths of a newton; the smooth network is several times worse; without touch both are far off', facts.feel_ht < 0.1 && facts.feel_st > 5 * facts.feel_ht && facts.feel_sc > 0.3 && facts.feel_hc > 0.3, [facts.feel_sc, facts.feel_st, facts.feel_hc, facts.feel_ht]);
  { // while slipping, the touch hybrid's force is exactly mu_k N
    let w = 0; for (const [b, m] of [['A', 1], ['B', 2]]) for (let F = 6; F <= 12; F += 0.5) if (F > MUS * m * G0 + 0.01) { const tr = L15.blockRoll(BM.ht, b, F, TP, 12); w = Math.max(w, Math.abs(tr.F[3] - MUK * m * G0)); }
    ok('the touch hybrid feels mu_k N while the block slips', w < 1e-6, w);
  }
}
const sweepErr = model => { let sA = 0, sB = 0, n = 0; for (let k = 0; k <= 120; k++) { const F = k / 10; sA += Math.abs(roll1(model, 'A', F, TP) - closedFinal(1, F, TP)); sB += Math.abs(roll1(model, 'B', F, TP) - closedFinal(2, F, TP)); n++; } return { A: sA / n, B: sB / n, mean: (sA + sB) / (2 * n) }; };
const SW = { sc: sweepErr(BM.sc), st: sweepErr(BM.st), hc: sweepErr(BM.hc), ht: sweepErr(BM.ht) };
facts.sw_sc = SW.sc.mean; facts.sw_st = SW.st.mean; facts.sw_hc = SW.hc.mean; facts.sw_ht = SW.ht.mean;
facts.sw_sc_A = SW.sc.A; facts.sw_sc_B = SW.sc.B; facts.sw_st_A = SW.st.A; facts.sw_st_B = SW.st.B;
ok('2 x 2: touch removes the information floor, the hybrid removes the smoothness floor', SW.sc.mean > 3 * SW.st.mean && SW.hc.mean > 3 * SW.ht.mean && SW.st.mean > 5 * SW.ht.mean && SW.sc.mean > 0.15, SW);
facts.sw_floor_ratio = facts.sw_sc / facts.sw_st; facts.sw_blur_ratio = facts.sw_st / facts.sw_ht;
{ // the 90 % rule of the camera-only hybrid is a design choice: at 50 % its cell is about the smooth network's, still on the information floor
  facts.sw_hc_p50 = sweepErr(fitBlockHybrid(false, 0.5)).mean;
  ok('camera-only hybrid with a 50 % switch: still within 15 % of the camera-only smooth network and far above the touch cells', facts.sw_hc_p50 > 0.85 * facts.sw_sc && facts.sw_hc_p50 < 1.15 * facts.sw_sc && facts.sw_hc_p50 > 3 * facts.sw_st && facts.sw_hc_p50 < facts.sw_hc, [facts.sw_hc_p50, facts.sw_sc, facts.sw_st, facts.sw_hc]);
}
{ // soft stick
  facts.creep_F = 4.6; facts.creep_pred = roll1(BM.st, 'A', 4.6, TP); facts.creep_true = closedFinal(1, 4.6, TP); facts.creep_hyb = roll1(BM.ht, 'A', 4.6, TP);
  let lo = null; for (let F = 0.5; F < facts.Fs_A; F += 0.01) if (roll1(BM.st, 'A', F, TP) > 0.01) { lo = F; break; } facts.creep_lo = lo; facts.creep_band = facts.Fs_A - lo;
  ok('the smooth model with touch lets a block that cannot move slide: 4.6 N moves block A by more than 5 cm in its imagination, the hybrid by none', facts.creep_pred > 0.05 && facts.creep_hyb === 0 && facts.creep_true === 0, [facts.creep_pred, facts.creep_hyb]);
  // creep as a fixed point: a block at rest, 4.6 N held forever, one step at a time (model)
  let x = 0, v = 0, steps = 0; for (let t = 0; t < 60; t++) { const o = BM.st.step('A', x, v, 4.6); x = o[0]; v = o[1]; } facts.creep_run_v = v; facts.creep_run_x = x;
}
facts.mu_k_hat = -BM.ht.law[0] / (G0 * DTB); facts.mu_s_hat = BM.ht.theta; facts.mu_s_hat_cam = BM.hc.theta; facts.sw_sharp = BM.ht.sharp;
ok('the hybrid with touch recovers mu_k to 3 digits and mu_s to 1 %', close(facts.mu_k_hat, MUK, 1e-3) && Math.abs(facts.mu_s_hat / MUS - 1) < 0.01, [facts.mu_k_hat, facts.mu_s_hat]);
facts.g_hat = BM.ht.law[6 + 0] / DTB;                                                 // the law's slope on u = F/N is g dt
ok('the slope of the slip law on F/N is g dt', close(BM.ht.law[6], G0 * DTB, 1e-6), BM.ht.law[6]);
{ // one-step errors: steps where the mode changes against the others
  const err = (model, touch) => { let a = [0, 0], b = [0, 0]; for (const s of btest) { const o = model.step(s.blk, 0, s.v, s.F), e = o[1] - (s.v + s.dv); if (s.slip0 !== s.slip1) { a[0] += e * e; a[1]++; } else { b[0] += e * e; b[1]++; } } return { sw: Math.sqrt(a[0] / a[1]), other: Math.sqrt(b[0] / b[1]), nsw: a[1], n: a[1] + b[1] }; };
  const es = err(BM.st), eh = err(BM.ht);
  facts.os_sw_smooth = es.sw; facts.os_other_smooth = es.other; facts.os_ratio_smooth = es.sw / es.other; facts.os_sw_hyb = eh.sw; facts.os_other_hyb = eh.other; facts.os_switch_pct = 100 * es.nsw / es.n;
  ok('smooth model with touch: the steps that change mode carry several times the error of the others', facts.os_ratio_smooth > 2, es);
  // mode accuracy: at the first step of a push (both blocks at rest) does the block start to slide?  hybrid with and without touch
  const first = btest.filter((s, i) => i % 40 === 0 && s.F > 3), band = first.filter(s => s.F > facts.Fs_A + 0.2 && s.F < facts.Fs_B - 0.2);
  const acc = (model, set) => set.filter(s => (model.pStart(model === BM.ht ? s.F / s.N : s.F) >= 0.9 ? 1 : 0) === s.slip1).length / set.length;
  facts.acc_touch = 100 * acc(BM.ht, first); facts.acc_cam = 100 * acc(BM.hc, first); facts.acc_touch_band = 100 * acc(BM.ht, band); facts.acc_cam_band = 100 * acc(BM.hc, band);
  facts.rest_n = first.length; facts.band_n = band.length; facts.band_move_pct = 100 * band.filter(s => s.slip1).length / band.length;
  ok('in the band between the two thresholds half the blocks move and the camera cannot tell which', Math.abs(facts.band_move_pct - 50) < 12 && facts.acc_cam_band < 65 && facts.acc_touch_band > 99, [facts.band_move_pct, facts.acc_cam_band, facts.acc_touch_band, facts.band_n]);
}
{ // the numbers the widget shows are one network seed and one log: here are the ranges over eight seeds (smooth models) and five logs (hybrids)
  const rms = model => { let e = 0; for (const s of btest) { const o = model.step(s.blk, 0, s.v, s.F); e += (o[2] - s.f) ** 2; } return Math.sqrt(e / btest.length); };
  const swS = NT.map(m => sweepErr(m).mean), swC = NC.map(m => sweepErr(m).mean);
  facts.sw_st_min = Math.min(...swS); facts.sw_st_max = Math.max(...swS); facts.sw_sc_min = Math.min(...swC); facts.sw_sc_max = Math.max(...swC);
  const fl = swC.map((x, i) => x / swS[i]); facts.sw_floor_min = Math.min(...fl); facts.sw_floor_max = Math.max(...fl);
  ok('the widget\'s smooth network with touch (seed 3) has the largest sweep error of its eight seeds: the worst case, not a typical one', close(swS[0], facts.sw_st_max, 1e-12), swS);
  const cr = NT.map(m => roll1(m, 'A', 4.6, TP)); facts.creep_pred_min = Math.min(...cr); facts.creep_pred_max = Math.max(...cr);
  const lows = NT.map(m => { for (let F = 0.5; F < facts.Fs_A; F += 0.01) if (roll1(m, 'A', F, TP) > 0.01) return F; return facts.Fs_A; }); facts.creep_F_min = Math.min(...lows); facts.creep_F_max = Math.max(...lows);
  ok('every one of the eight smooth networks with touch creeps: block A moves by more than 3 cm at 4.6 N, below its 4.905 N threshold; the widget\'s moves it most and starts earliest', cr.every(x => x > 0.03) && close(cr[0], facts.creep_pred_max, 1e-12) && close(lows[0], facts.creep_F_min, 1e-12), [cr, lows]);
  const fS = NT.map(rms), fC = NC.map(rms); facts.feel_st_min = Math.min(...fS); facts.feel_st_max = Math.max(...fS);
  const H = [1, 2, 3, 4, 5].map(ls => { const lg = ls === 1 ? blog : buildBlockLog(30, ls); return { ht: fitBlockHybrid(true, 0.9, lg), hc: fitBlockHybrid(false, 0.9, lg) }; });
  const swHT = H.map(h => sweepErr(h.ht).mean), swHC = H.map(h => sweepErr(h.hc).mean), fHT = H.map(h => rms(h.ht)), fHC = H.map(h => rms(h.hc));
  facts.sw_ht_min = Math.min(...swHT); facts.sw_ht_max = Math.max(...swHT); facts.sw_hc_min = Math.min(...swHC); facts.sw_hc_max = Math.max(...swHC);
  facts.feel_ht_min = Math.min(...fHT); facts.feel_ht_max = Math.max(...fHT); facts.feel_cam_min = Math.min(...fC, ...fHC); facts.feel_cam_max = Math.max(...fC, ...fHC);
  ok('the widget\'s hybrid with touch (log 1) has the smallest sweep error and the smallest force error of its five logs: the best case', close(swHT[0], facts.sw_ht_min, 1e-12) && close(fHT[0], facts.feel_ht_min, 1e-12), [swHT, fHT]);
  const bl = []; for (const s1 of swS) for (const s2 of swHT) bl.push(s1 / s2); facts.sw_blur_min = Math.min(...bl); facts.sw_blur_max = Math.max(...bl);
  ok('over every seed and log the hybrid with touch beats the smooth network with touch at least threefold', facts.sw_blur_min > 3, bl);
  const mus = H.map(h => h.ht.theta), muk = H.map(h => -h.ht.law[0] / (G0 * DTB)); facts.mu_s_hat_min = Math.min(...mus); facts.mu_s_hat_max = Math.max(...mus);
  ok('on every log the touch hybrid recovers mu_k to 3 digits and mu_s to 2 %', muk.every(x => close(x, MUK, 1e-3)) && mus.every(x => Math.abs(x / MUS - 1) < 0.02), [muk, mus]);
  const thr90 = h => { for (let F = 0; F < 60; F += 0.01) if (h.hc.pStart(F) >= 0.9) return F; return Infinity; };
  const t5 = H.map(thr90); facts.cam_thr90 = t5[0]; facts.cam_thr90_min = Math.min(...t5); facts.cam_thr90_max = Math.max(...t5); facts.cam_thr50_min = Math.min(...H.map(h => h.hc.theta)); facts.cam_thr50_max = Math.max(...H.map(h => h.hc.theta));
  ok('the camera-only hybrid is 50 % sure between the two thresholds (4.905 and 9.81 N) or just above, and is 90 % sure only at 11.5 N or more, in every log', H.every(h => h.hc.theta > facts.Fs_A) && facts.cam_thr90_min > 11.5, [t5, H.map(h => h.hc.theta)]);
}
lap('block sweeps');

/* ═══════════════════════════ 8. words and the planner ═══════════════════════════ */
{
  const TARGETS = [0.15, 0.25, 0.35], names = { sc: 'smooth/camera', st: 'smooth/touch', hc: 'hybrid/camera', ht: 'hybrid/touch' };
  const suite = (model, words, seed) => {
    const rows = []; for (const b of ['A', 'B']) for (const xs of TARGETS) { const p = L15.plan({ step: model.step }, b, xs, words, seed), real = closedFinal(MASS[b], p.F, p.Tp); rows.push({ b, xs, F: p.F, Tp: p.Tp, real, ok: Math.abs(real - xs) <= 0.05 }); } return rows;
  };
  const eng = { sc: new L15.BlockSmooth(false, 3).train(L15.blockLog(30, 1)), st: new L15.BlockSmooth(true, 3).train(L15.blockLog(30, 1)), hc: new L15.BlockHybrid(false, L15.blockLog(30, 1)), ht: new L15.BlockHybrid(true, L15.blockLog(30, 1)) };
  const counts = {};
  for (const words of ['none', 'briefly', 'gently']) for (const k of Object.keys(BM)) {
    const rows = suite(BM[k], words, 11), n = rows.filter(r => r.ok).length; counts[words + '/' + k] = n; facts['pl_' + words + '_' + k] = n;
    const re = L15.planSuite(eng[k], words, 11); ok('the engine planner gives the same plans as the oracle (' + words + ', ' + names[k] + ')', re.every((r, i) => Math.abs(r.F - rows[i].F) < 1e-9 && r.Tp === rows[i].Tp));
    if (words === 'gently' && k === 'ht') facts.pl_gently_ht_F_A = rows[1].F, facts.pl_gently_ht_F_B = rows[4].F;
    if (words === 'briefly' && k === 'ht') facts.pl_briefly_ht_F_A = rows[1].F, facts.pl_briefly_ht_F_B = rows[4].F;
    if (words === 'gently' && k === 'st') { facts.pl_gently_st_F_A = rows[0].F; facts.pl_gently_st_real_A = rows[0].real; facts.pl_gently_st_imag_A = roll1(BM.st, 'A', rows[0].F, rows[0].Tp); }
  }
  ok('"briefly" (far from the discontinuity): both touch models hit the mark every time', counts['briefly/st'] === 6 && counts['briefly/ht'] === 6, counts);
  ok('"gently" (at the discontinuity): the smooth model fails every case and the hybrid hits all of them', counts['gently/st'] === 0 && counts['gently/ht'] === 6, counts);
  ok('the camera-only models cannot do either (they cannot tell the blocks apart)', counts['briefly/sc'] <= 1 && counts['briefly/hc'] <= 1 && counts['gently/sc'] === 0 && counts['gently/hc'] === 0, counts);
  // robustness: other CEM seeds; eight smooth networks (seeds 3..10) for the smooth models, which is where the luck of the draw lives
  const rangeOf = (arr) => ({ min: Math.min(...arr), max: Math.max(...arr), mean: arr.reduce((a, b) => a + b, 0) / arr.length });
  const nets = NT, netsC = NC;
  for (const words of ['none', 'briefly', 'gently']) {
    const r = rangeOf(nets.map(m => suite(m, words, 11).filter(x => x.ok).length)); facts['pl8_st_' + words + '_min'] = r.min; facts['pl8_st_' + words + '_max'] = r.max; facts['pl8_st_' + words + '_mean'] = r.mean;
    const rc = rangeOf(netsC.map(m => suite(m, words, 11).filter(x => x.ok).length)); facts['pl8_sc_' + words + '_max'] = rc.max;
    const rh = rangeOf([11, 12, 13, 14, 15].map(sd => suite(BM.ht, words, sd).filter(x => x.ok).length)); facts['pl5_ht_' + words + '_min'] = rh.min;
    const rhc = rangeOf([11, 12, 13, 14, 15].map(sd => suite(BM.hc, words, sd).filter(x => x.ok).length)); facts['pl5_hc_' + words + '_max'] = rhc.max;
  }
  ok('eight smooth networks with touch: "briefly" plans work far more often than "gently" ones', facts.pl8_st_briefly_mean >= 4 && facts.pl8_st_gently_mean <= 2.5 && facts.pl8_st_briefly_mean - facts.pl8_st_gently_mean >= 2, [facts.pl8_st_briefly_mean, facts.pl8_st_gently_mean]);
  ok('hybrid with touch hits all six marks under every phrase and every planner seed', facts.pl5_ht_none_min === 6 && facts.pl5_ht_briefly_min === 6 && facts.pl5_ht_gently_min === 6);
  ok('camera-only models hit at most one mark of six, hybrid or smooth, under any phrase', facts.pl5_hc_none_max <= 1 && facts.pl5_hc_briefly_max <= 1 && facts.pl5_hc_gently_max <= 1 && facts.pl8_sc_none_max <= 1 && facts.pl8_sc_briefly_max <= 1 && facts.pl8_sc_gently_max <= 1);
  facts.pl_pop = 80; facts.pl_iters = 8; facts.pl_rollouts = 80 * 8; facts.pl_model_steps = 80 * 8 * L15.TROLL; facts.pl_marks = TARGETS.length * 2; facts.pl_tol_cm = 5;
  // the shape of the discontinuity that gently looks for: the gentle plan for block A sits within X N of mu_s N
  facts.pl_gently_margin_A = facts.pl_gently_ht_F_A - facts.Fs_A; facts.pl_gently_margin_B = facts.pl_gently_ht_F_B - facts.Fs_B;
  lap('planner');
}

/* ═══════════════════════════ 9. the decoy: lesson 1's nudge task, closed loop ═══════════════════════════ */
{
  const W = CY.world({ curtain: null }), GOAL = W.goal, TA = 12, TF = 80;
  const launches = seed => { const r = CY.rng(seed), out = []; for (let i = 0; i < 60; i++) { const s0 = CY.launch(W, r); let a = [s0[0], s0[2]], b = [s0[1], s0[3]]; for (let t = 0; t < TA; t++) { const o = stepWall('x', a[0], a[1]), q = stepWall('y', b[0], b[1]); a = [o[0], o[1]]; b = [q[0], q[1]]; } out.push([a[0], b[0], a[1], b[1]]); } return out; };
  const cands = (K, seed) => { const r = CY.rng(seed), out = []; for (let k = 0; k < K; k++) { const an = 2 * Math.PI * r(), am = 3 * Math.sqrt(r()); out.push([am * Math.cos(an), am * Math.sin(an)]); } return out; };
  const imagine = (px, py, s, a) => { let x = s[0], y = s[1], vx = s[2] + a[0], vy = s[3] + a[1]; for (let t = 0; t <= TF; t++) { const o = px(x, vx), q = py(y, vy); x = o[0]; vx = o[1]; y = q[0]; vy = q[1]; } return [x, y]; };
  const trueEnd = (s, a) => { let x = s[0], y = s[1], vx = s[2] + a[0], vy = s[3] + a[1], hit = 0; for (let t = 0; t <= TF; t++) { const o = stepWall('x', x, vx), q = stepWall('y', y, vy); if (o[2] || q[2]) hit = 1; x = o[0]; vx = o[1]; y = q[0]; vy = q[1]; } return [x, y, hit]; };
  const closed = (px, py, ls, C) => { let succ = 0, imag = 0, real = 0, hits = 0, same = 0; for (const s of ls) { let best = Infinity, bk = 0, bf = null; for (let k = 0; k < C.length; k++) { const f = imagine(px, py, s, C[k]), m = Math.hypot(f[0] - GOAL.x, f[1] - GOAL.y); if (m < best) { best = m; bk = k; bf = f; } } const e = trueEnd(s, C[bk]), mr = Math.hypot(e[0] - GOAL.x, e[1] - GOAL.y); if (mr < GOAL.r) succ++; imag += best; real += mr; hits += e[2]; if (Math.hypot(e[0] - bf[0], e[1] - bf[1]) < 1e-6) same++; } return { success: succ / ls.length, imagined: imag / ls.length, real: real / ls.length, hits: hits / ls.length, same: same / ls.length }; };
  const LS = launches(5), C = cands(128, 1000);
  const oneStep = (px, py) => { const a = errors(px, 'x', test2.x), b = errors(py, 'y', test2.y); return Math.sqrt((a.all ** 2 * test2.x.length + b.all ** 2 * test2.y.length) / (test2.x.length + test2.y.length)); };
  const exactX = (p, v) => stepWall('x', p, v), exactY = (p, v) => stepWall('y', p, v), fric = (p, v) => [p + GLD * v, DEC * v];
  const hx = hyb, hy = fitHybrid('y', log1.y, 1e-5);
  const R = {};
  R.exact = closed(exactX, exactY, LS, C); R.exact.rms = oneStep(exactX, exactY);
  R.hybrid = closed(hx.pred, hy.pred, LS, C); R.hybrid.rms = oneStep(hx.pred, hy.pred);
  R.fric = closed(fric, fric, LS, C); R.fric.rms = oneStep(fric, fric);
  const sm = [];
  for (const sd of [3, 4, 5, 6, 7, 8]) { const px = predNet('x', sd === 3 ? net3 : trainNet('x', log1.x, sd)), py = predNet('y', trainNet('y', log1.y, sd + 100)); const r = closed(px, py, LS, C); r.rms = oneStep(px, py); sm.push(r); }
  lap('decoy models');
  const mm = f => [Math.min(...sm.map(f)), Math.max(...sm.map(f))];
  facts.d_succ_exact = 100 * R.exact.success; facts.d_succ_hybrid = 100 * R.hybrid.success; facts.d_succ_fric = 100 * R.fric.success;
  [facts.d_succ_sm_min, facts.d_succ_sm_max] = mm(r => 100 * r.success); [facts.d_rms_sm_min, facts.d_rms_sm_max] = mm(r => r.rms);
  facts.d_rms_hybrid = R.hybrid.rms; facts.d_rms_fric = R.fric.rms; facts.d_rms_exact = R.exact.rms;
  facts.d_imag_fric = R.fric.imagined; facts.d_real_fric = R.fric.real; facts.d_imag_hybrid = R.hybrid.imagined; facts.d_real_hybrid = R.hybrid.real; facts.d_imag_exact = R.exact.imagined;
  [facts.d_imag_sm_min, facts.d_imag_sm_max] = mm(r => r.imagined); [facts.d_real_sm_min, facts.d_real_sm_max] = mm(r => r.real);
  facts.d_succ_sm_s3 = 100 * sm[0].success; facts.d_rms_sm_s3 = sm[0].rms;
  facts.d_n_launch = LS.length; facts.d_K = C.length;
  facts.d_hit_hybrid_pct = 100 * R.hybrid.hits; facts.d_hit_fric_pct = 100 * R.fric.hits; facts.d_same_fric_pct = 100 * R.fric.same; [facts.d_hit_sm_min, facts.d_hit_sm_max] = mm(r => 100 * r.hits);
  ok('the friction-only model picks nudges that never touch a wall, so what it imagines is what happens; the hybrid uses the walls in most launches', R.fric.hits === 0 && R.fric.same === 1 && R.hybrid.hits > 0.5, [R.fric.hits, R.fric.same, R.hybrid.hits]);
  ok('the exact model succeeds on (nearly) every launch', R.exact.success >= 0.95, R.exact);
  ok('hybrid: best one-step RMS of the learned models, and as good as the exact model in the loop', R.hybrid.rms < Math.min(R.fric.rms, ...sm.map(r => r.rms)) && R.hybrid.success >= 0.95, R.hybrid);
  ok('REVERSAL: every smooth network has a lower one-step RMS than the friction-only model ...', sm.every(r => r.rms < R.fric.rms), [sm.map(r => r.rms), R.fric.rms]);
  ok('... and a lower closed-loop success (all six, by at least 30 points)', sm.every(r => r.success + 0.30 < R.fric.success), [sm.map(r => r.success), R.fric.success]);
  facts.d_imag_sm_mean = sm.reduce((a, r) => a + r.imagined, 0) / sm.length; facts.d_real_sm_mean = sm.reduce((a, r) => a + r.real, 0) / sm.length;
  ok('on average the smooth networks imagine landing 0.4 m closer than they do, the friction-only model is calibrated (imagined == real)', facts.d_real_sm_mean - facts.d_imag_sm_mean > 0.4 && close(R.fric.imagined, R.fric.real, 1e-9), [facts.d_imag_sm_mean, facts.d_real_sm_mean, R.fric]);
  ok('every smooth network misses by more than 1 m on average', sm.every(r => r.real > 1.0), sm.map(r => r.real));
  { const e = L15.t1((p, v) => hx.pred(p, v), (p, v) => hy.pred(p, v), L15.t1Launches(60, 5), L15.t1Cands(128, 1000)); ok('the engine closed loop == the oracle closed loop (hybrid)', close(e.success, R.hybrid.success, 1e-9) && close(e.real, R.hybrid.real, 1e-9), [e, R.hybrid]); }
  // other launch seeds: friction-only and smooth
  const fs = [], ss = [];
  for (const sd of [6, 7, 8, 9]) { const l2 = launches(sd); fs.push(closed(fric, fric, l2, C).success); ss.push(closed(predNet('x', net3), predNet('y', trainNet('y', log1.y, 103)), l2, C).success); }
  facts.d_fric_launches_min = 100 * Math.min(...fs); facts.d_fric_launches_max = 100 * Math.max(...fs); facts.d_sm_launches_max = 100 * Math.max(...ss);
  ok('other launch sets: friction-only stays well above the smooth network', Math.min(...fs) > Math.max(...ss) + 0.15, [fs, ss]);
  lap('decoy done');
}
// numbers for the exercise
{ const m = 3, mus = 0.4, muk = 0.25; facts.ck_m = m; facts.ck_Fs = mus * m * G0; facts.ck_Fk = muk * m * G0; facts.ck_drop = facts.ck_Fs - facts.ck_Fk; facts.ck_sigF = m * facts.sig_a; facts.ck_ratio = facts.ck_sigF / facts.ck_drop; }


/* ═══════════════════════════ 10. the numbers of the prose, in the units the prose uses, and the claims that go with them ═══════════════════════════ */
{
  ['d_star', 'd_star_1', 'd_star_3', 'sm_width', 'sm_width_min', 'sm_width_max', 'sm_logs_width_min', 'sm_logs_width_max', 'road_ep240', 'road_ep480', 'road_ep720', 'road_h32', 'road_big', 'road_x20',
   'roll_truth_d', 'roll_sm_d_min', 'roll_sm_d_max', 'sw_sc', 'sw_hc', 'sw_hc_p50', 'sw_st', 'sw_ht', 'creep_pred', 'sm_off', 'road_x20_off',
   'sw_sc_min', 'sw_sc_max', 'sw_st_min', 'sw_st_max', 'sw_hc_min', 'sw_hc_max', 'sw_ht_min', 'sw_ht_max', 'creep_pred_min', 'creep_pred_max'].forEach(k => { facts[k + '_cm'] = 100 * facts[k]; });
  facts.v_bounce_abs = -facts.v_bounce; facts.law_bounce_abs = -facts.law_bounce_gain;
  facts.roll_truth_away = -facts.roll_truth_v; facts.roll_sm_away_min = -facts.roll_sm_v_max; facts.roll_sm_away_max = -facts.roll_sm_v_min;
  facts.ramp_w_cm = facts.sm_width_cm / 0.8; facts.w12_mm = 1000 * (facts.sm_width / 0.8) / 12;
  facts.drop_acc = (MUS - MUK) * G0; facts.jump_cm = 100 * facts.jump_A; facts.sig_F_over_Fs_pct = 100 * facts.sig_F_over_Fs_A;
  { const w1 = width1090(smooth, 1), w3 = width1090(smooth, 3); facts.sm_width_v1_cm = 100 * w1; facts.sm_width_v3_cm = 100 * w3; ok('the smooth network has a ramp at 1 and 3 m/s too', w1 > 0 && w3 > 0, [w1, w3]); }
  ok('the sawtooth identity: a hybrid switch within w/12 of the edge beats the ramp (here by a factor ~8 in length)', facts.hy_delta_mm < facts.w12_mm / 5, [facts.hy_delta_mm, facts.w12_mm]);
  ok('the free-flight decay and the upper-wall gain printed in the prose are the physics', close(facts.law_bounce_abs, EREST * DEC, 1e-8) && close(facts.law_free_decay, facts.decay, 1e-8));
  ok('the acceleration error from three readings equals the friction drop (mu_s - mu_k) g to 0.2 %', Math.abs(facts.sig_a / facts.drop_acc - 1) < 0.002, [facts.sig_a, facts.drop_acc]);
  { // the constants the prose states about the planner are the engine's
    ok('planner constants in the prose: F_max 12 N, T_max 10 steps, 60-step rollouts, marks 15/25/35 cm, 80 candidates x 8 iterations (read from the engine source)',
       L15.FMAX === 12 && L15.TMAX === 10 && L15.TROLL === 60 && L15.PLAN_TARGETS.join() === '0.15,0.25,0.35' && /iters: 8, pop: 80/.test(fs.readFileSync(path.join(DIR, 'l15_contact.js'), 'utf8')));
  }
  ok('road: every variant is narrower than the baseline ramp, none is below 10 cm, and the narrowest has the worst error within half a metre',
     [facts.road_ep480, facts.road_ep720, facts.road_h32, facts.road_big, facts.road_x20].every(w => w < facts.sm_width && w > 0.10) && facts.road_x20 === Math.min(facts.road_ep480, facts.road_ep720, facts.road_h32, facts.road_big, facts.road_x20) && facts.road_x20_near > facts.sm_near && facts.road_near720 < facts.sm_near,
     [facts.sm_width, facts.road_ep480, facts.road_ep720, facts.road_h32, facts.road_big, facts.road_x20, facts.road_x20_near, facts.sm_near]);
  ok('2 x 2: without touch the hybrid is no better than the smooth network, and its single switch sits between the two thresholds', facts.sw_hc >= facts.sw_sc && facts.mu_s_hat_cam > facts.Fs_A && facts.mu_s_hat_cam < facts.Fs_B, [facts.sw_hc, facts.sw_sc, facts.mu_s_hat_cam]);
  ok('first push: the touch switch is right 99 % of the time, the camera switch hardly better than a coin', facts.acc_touch > 98 && facts.acc_cam < 60, [facts.acc_touch, facts.acc_cam]);
  ok('the gentle smooth plan for A sits below the threshold, imagines the mark (within 5 cm) and the real block does not move', facts.pl_gently_st_F_A < facts.Fs_A && Math.abs(facts.pl_gently_st_imag_A - 0.15) <= 0.05 && facts.pl_gently_st_real_A === 0, [facts.pl_gently_st_F_A, facts.pl_gently_st_imag_A, facts.pl_gently_st_real_A]);
  ok('the gentle hybrid plans sit just above mu_s N and the brief ones far above', facts.pl_gently_margin_A > 0 && facts.pl_gently_margin_A < 1.2 && facts.pl_gently_margin_B > 0 && facts.pl_gently_margin_B < 1.2 && facts.pl_briefly_ht_F_A > facts.Fs_A + 3, [facts.pl_gently_margin_A, facts.pl_gently_margin_B, facts.pl_briefly_ht_F_A]);
  ok('the gentle hybrid plans for the 25 cm mark push less than the brief ones (A and B)', facts.pl_gently_ht_F_A < facts.pl_briefly_ht_F_A && facts.pl_gently_ht_F_B < facts.pl_briefly_ht_F_B, [facts.pl_gently_ht_F_A, facts.pl_briefly_ht_F_A, facts.pl_gently_ht_F_B, facts.pl_briefly_ht_F_B]);
  { // the soft-contact road: a spring wall F = k (penetration) lasts pi sqrt(m / k)
    const k = 1e5, m = 1, h = 1e-6; let y = 0, v = 1, t = 0; do { v -= (k * y / m) * h; y += v * h; t += h; } while (y > 0 && t < 0.1);
    facts.soft_tc_ms = 1000 * t; facts.soft_sub = DT / 0.001;
    ok('a stiff-spring contact lasts pi sqrt(m / k) (simulated at 1 microsecond)', close(t, Math.PI * Math.sqrt(m / k), 2e-5) && close(-v, 1, 2e-3), [t, v]);
  }
  { // "try": the start state of the widget
    const F = 7; facts.try_F = F; facts.try_A_true = 100 * closedFinal(1, F, TP); facts.try_B_true = 100 * closedFinal(2, F, TP);
    facts.try_sc = 100 * roll1(BM.sc, 'A', F, TP); facts.try_hc = 100 * roll1(BM.hc, 'A', F, TP);
    ok('camera-only models answer the same for both blocks, and block B truly does not move at 7 N', roll1(BM.sc, 'A', F, TP) === roll1(BM.sc, 'B', F, TP) && roll1(BM.hc, 'A', F, TP) === roll1(BM.hc, 'B', F, TP) && facts.try_B_true === 0, [facts.try_sc, facts.try_hc]);
    facts.try_st_A = 100 * roll1(BM.st, 'A', F, TP); facts.try_ht_A = 100 * roll1(BM.ht, 'A', F, TP); facts.try_st_B = 100 * roll1(BM.st, 'B', F, TP); facts.try_ht_B = 100 * roll1(BM.ht, 'B', F, TP);
    ok('with touch the hybrid is right for both blocks at 7 N (within 0.5 cm) and the smooth network is further off for both', Math.abs(facts.try_ht_A - facts.try_A_true) < 0.5 && Math.abs(facts.try_ht_B) < 0.5 && Math.abs(facts.try_st_A - facts.try_A_true) > Math.abs(facts.try_ht_A - facts.try_A_true) && Math.abs(facts.try_st_B) > Math.abs(facts.try_ht_B), [facts.try_st_A, facts.try_ht_A, facts.try_st_B, facts.try_ht_B]);
  }
  lap('prose facts');
}

/* ═══════════════════════════ 11. the page's own widget ═══════════════════════════ */
{
  const PAGE = path.join(DIR, '15_bodies_contact_language.html');
  const page = loadPage(PAGE, { dpr: 1, console: { log() {}, warn() {}, error() {} } });
  const same = (id, want, tol, what) => { const got = page.num(id); ok('widget #' + id + ' (' + what + ') = ' + want.toFixed(4) + ', page prints ' + page.text(id), Math.abs(got - want) <= tol, [got, want]); };
  const sets = (obj) => { for (const k of Object.keys(obj)) page.set('w15-' + k, obj[k]); };
  // the start state: the wall at 2 m/s, block A pushed with 7 N, camera only
  same('w15-ds', facts.d_star_cm, 0.0501, 'bounce edge'); same('w15-wd', facts.sm_width_cm, 0.0501, 'smooth ramp width'); same('w15-dl', facts.hy_delta_mm, 0.0501, 'hybrid edge error');
  same('w15-near', facts.sm_near, 0.00051, 'error within 0.5 m'); same('w15-wr', facts.hy_wrong, 0.5, 'hybrid wrong mode'); same('w15-ep', 120, 0.5, 'epochs');
  ok('wrong-mode readout names the number of held-out steps', page.text('w15-wr').replace(/,/g, '').includes(String(facts.n_steps_test)), page.text('w15-wr'));
  same('w15-tr', facts.try_A_true, 0.0501, 'block A truth at 7 N'); same('w15-sm', facts.try_sc, 0.0501, 'camera-only smooth'); same('w15-hy', facts.try_hc, 0.0501, 'camera-only hybrid');
  same('w15-es', facts.sw_sc_cm, 0.0501, 'camera-only smooth sweep error'); same('w15-eh', facts.sw_hc_cm, 0.0501, 'camera-only hybrid sweep error'); same('w15-mu', facts.mu_s_hat_cam, 0.0501, 'camera-only switch');
  sets({ blk: 'B' });
  same('w15-tr', facts.try_B_true, 0.0501, 'block B truth at 7 N'); same('w15-sm', facts.try_sc, 0.0501, 'B: the camera-only smooth model says the same'); same('w15-hy', facts.try_hc, 0.0501, 'B: the camera-only hybrid says the same');
  sets({ touch: 'touch' });
  same('w15-sm', facts.try_st_B, 0.0501, 'B touch smooth'); same('w15-hy', facts.try_ht_B, 0.0501, 'B touch hybrid');
  same('w15-es', facts.sw_st_cm, 0.00501, 'touch smooth sweep error'); same('w15-eh', facts.sw_ht_cm, 0.00501, 'touch hybrid sweep error');
  { const t = page.text('w15-mu'); const mus = +/μs ([\d.]+)/.exec(t)[1], muk = +/μk ([\d.]+)/.exec(t)[1]; ok('widget switch estimates ' + t, Math.abs(mus - facts.mu_s_hat) < 0.00051 && Math.abs(muk - facts.mu_k_hat) < 0.00051, [mus, muk]); }
  sets({ blk: 'A' });
  same('w15-sm', facts.try_st_A, 0.0501, 'A touch smooth'); same('w15-hy', facts.try_ht_A, 0.0501, 'A touch hybrid');
  sets({ f: 4.6 });
  same('w15-tr', 0, 0.0501, 'A at 4.6 N truth'); same('w15-sm', facts.creep_pred_cm, 0.0501, 'creep of the smooth model'); same('w15-hy', 0, 0.0501, 'hybrid at 4.6 N');
  // the wall at 1 and 3 m/s
  sets({ v: 1 }); same('w15-ds', facts.d_star_1_cm, 0.0501, 'edge at 1 m/s'); same('w15-dl', facts.hy_delta1_mm, 0.0501, 'hybrid edge error at 1 m/s'); same('w15-wd', facts.sm_width_v1_cm, 0.0501, 'ramp at 1 m/s');
  sets({ v: 3 }); same('w15-ds', facts.d_star_3_cm, 0.0501, 'edge at 3 m/s'); same('w15-dl', facts.hy_delta3_mm, 0.0501, 'hybrid edge error at 3 m/s'); same('w15-wd', facts.sm_width_v3_cm, 0.0501, 'ramp at 3 m/s');
  sets({ v: 2 });
  // plans: touch, three phrases; then camera only
  const planOf = () => { page.click('w15-plan'); return [page.num('w15-ps'), page.num('w15-ph')]; };
  sets({ touch: 'touch', words: 'none' }); { const [a, b] = planOf(); ok('plan, touch, to the mark: smooth ' + a + ', hybrid ' + b, a === facts.pl_none_st && b === facts.pl_none_ht, [a, b]); }
  sets({ words: 'briefly' }); { const [a, b] = planOf(); ok('plan, touch, briefly: smooth ' + a + ', hybrid ' + b, a === facts.pl_briefly_st && b === facts.pl_briefly_ht, [a, b]); }
  sets({ words: 'gently' }); { const [a, b] = planOf(); ok('plan, touch, gently: smooth ' + a + ', hybrid ' + b, a === facts.pl_gently_st && b === facts.pl_gently_ht, [a, b]); }
  sets({ touch: 'cam', words: 'none' }); { const [a, b] = planOf(); ok('plan, camera only, to the mark: smooth ' + a + ', hybrid ' + b, a === facts.pl_none_sc && b === facts.pl_none_hc && a <= facts.pl5_hc_none_max && b <= facts.pl5_hc_none_max, [a, b]); }
  sets({ words: 'gently' }); { const [a, b] = planOf(); ok('plan, camera only, gently: smooth ' + a + ', hybrid ' + b, a === facts.pl_gently_sc && b === facts.pl_gently_hc, [a, b]); }
  // the nudge test
  page.click('w15-t1');
  { const rd = id => { const m = /([\d.]+) % \(rms ([\d.]+)\)/.exec(page.text(id)); return m ? [+m[1], +m[2]] : [NaN, NaN]; };
    const n0 = rd('w15-n0'), n1 = rd('w15-n1'), n2 = rd('w15-n2');
    ok('nudge test, friction only: ' + page.text('w15-n0'), Math.abs(n0[0] - facts.d_succ_fric) < 0.051 && Math.abs(n0[1] - facts.d_rms_fric) < 0.00051, [n0, facts.d_succ_fric, facts.d_rms_fric]);
    ok('nudge test, smooth: ' + page.text('w15-n1'), Math.abs(n1[0] - facts.d_succ_sm_s3) < 0.051 && Math.abs(n1[1] - facts.d_rms_sm_s3) < 0.00051, [n1, facts.d_succ_sm_s3, facts.d_rms_sm_s3]);
    ok('nudge test, hybrid: ' + page.text('w15-n2'), Math.abs(n2[0] - facts.d_succ_hybrid) < 0.051 && Math.abs(n2[1] - facts.d_rms_hybrid) < 0.00051, [n2, facts.d_succ_hybrid, facts.d_rms_hybrid]); }
  // training the wall network further: 1, 3 and 5 presses (the ramp narrows slowly)
  const press = n => { for (let i = 0; i < n; i++) page.click('w15-train'); };
  press(1); same('w15-wd', facts.road_ep240_cm, 0.0501, 'ramp after one press'); same('w15-ep', 240, 0.5, 'epochs after one press');
  press(2); same('w15-wd', facts.road_ep480_cm, 0.0501, 'ramp after three presses'); same('w15-near', facts.road_near480, 0.00051, 'error within 0.5 m after three presses');
  press(2); same('w15-wd', facts.road_ep720_cm, 0.0501, 'ramp after five presses'); same('w15-near', facts.road_near720, 0.00051, 'error within 0.5 m after five presses');
  ok('the page ran without a problem', page.problems.length === 0, page.problems);
  lap('widget driven');
}

if (require.main === module) { console.error(fails ? `${fails} check(s) FAILED` : 'all checks passed'); console.log(JSON.stringify({ facts })); process.exit(fails ? 1 : 0); }
