#!/usr/bin/env node
'use strict';
/* Oracle for robot_model_training lesson 08 (other bodies: units, pooling, interference).
 * Re-derives every number the lesson quotes with code written separately from the widget's path: its own recorder of demonstrations (an explicit plant), its own policy rollout
 * (per-chunk lookups, plain arrays, layout distance read off the posts of the two worlds), its own exchange-rate and statistics.  Only the world's primitives (arm, expert, posts,
 * collision) come from bench.js.  It then checks the closed forms the lesson derives (label displacement 2 d sin(q2/2), the share of own layouts among the nearest, the weight at
 * which a foreign layout stops winning), asserts each claim of the prose, drives the page's widget through the states the prose describes and compares what it prints.
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
const put = (k, v, d) => { F[k] = +(+v).toFixed(d === undefined ? 3 : d); };

/* ───── the experiment, written out independently ───── */
const DT = 0.05, JIT = 0.01, GUST = 0.08, CH = 16, KST = 20, NT = 1000, NFILE = 256;
const BODY = {
  A: { L1: 0.5, L2: 0.5, gain: 0.85 }, twin: { L1: 0.5, L2: 0.5 }, close: { L1: 0.51, L2: 0.49 }, near: { L1: 0.55, L2: 0.45 },
  old: { L1: 0.5, L2: 0.5, rgain: 0.85, lag: 0.1, noise: 0.12 },
};
const clip = (x) => Math.max(-1.5, Math.min(1.5, x));
function layouts(n, seed) { const r = BN.rng(seed), out = []; for (let i = 0; i < n; i++) { const s = (2 * r() - 1) * 0.10, t = (2 * r() - 1) * 0.20; out.push([s, t]); } return out; }
const worldOf = (th, b) => BN.slalom.world(5, { shift: th[0], tilt: th[1], body: { L1: b.L1, L2: b.L2 } });
const postY = new Map();                                   // the heights of the five posts of a layout, read off the world itself
function ys(th) { let v = postY.get(th); if (!v) { v = worldOf(th, BODY.A).posts.map((p) => p[1]); postY.set(th, v); } return v; }
function dist(a, b) { const ya = ys(a), yb = ys(b); let m = 0; for (let i = 0; i < 5; i++) m = Math.max(m, Math.abs(ya[i] - yb[i])); return m; }

/* a demonstration, with the plant written out: realised velocity = gain x clipped command (first-order lag if any), plus gust, every step */
function record(body, th, seed) {
  const w = worldOf(th, body), rng = BN.rng(seed), T = 2 * BN.slalom.horizon(w), g = body.rgain || 1, lag = body.lag || 0, nz = body.noise || 0, xe = BN.slalom.xEnd(w);
  const q = BN.slalom.startQ(w, JIT * BN.randn(rng)).slice(), v = [0, 0], Q = [], P = [];
  let coll = false, done = false;
  for (let t = 0; t < T; t++) {
    const p = BN.arm.fk(q, w.body); Q.push([q[0], q[1]]); P.push(p);
    if (BN.slalom.collide(w, p)) { coll = true; break; }
    if (p[0] > xe - 0.02) { done = true; break; }
    const u = BN.slalom.expertAct(w, q);
    for (let k = 0; k < 2; k++) { const c = clip(u[k]) * g; v[k] = lag > 0 ? v[k] + (DT / (lag + DT)) * (c - v[k]) : c; q[k] += DT * (v[k] + (nz ? nz * BN.randn(rng) : 0)); }
  }
  return { th, Q, P, n: Q.length, ok: done && !coll, coll, done, body };
}
function fileOf(key, thetas, m) { const out = []; for (let k = 0; k < m; k++) { const d = record(BODY[key], thetas[k], 500 + k); if (d.ok) { d.k = k; out.push(d); } } return out; }

/* one run of arm A on a test layout, following a stored demonstration; returns 'done' | 'coll' | 'tout' */
function follow(th, dm, space, seed) {
  const me = BODY.A, w = worldOf(th, me), rng = BN.rng(seed), T = BN.slalom.horizon(w), xr = BN.slalom.xEnd(w) - 0.02;
  const q = BN.slalom.startQ(w, JIT * BN.randn(rng)).slice();
  let i0 = 0;
  for (let t = 0; t < T; t++) {
    const p = BN.arm.fk(q, w.body);
    if (BN.slalom.collide(w, p)) return 'coll';
    if (p[0] > xr) return 'done';
    const j = t % CH;
    if (j === 0) {                                          // the stored frame nearest to the arm, by joint angles or by hand position
      let best = Infinity; const key = space === 'joint' ? q : p, store = space === 'joint' ? dm.Q : dm.P;
      for (let i = 0; i < dm.n; i++) { const dx = store[i][0] - key[0], dy = store[i][1] - key[1], e = dx * dx + dy * dy; if (e < best) { best = e; i0 = i; } }
    }
    const i = Math.min(i0 + j + 1, dm.n - 1);
    const target = space === 'joint' ? dm.Q[i] : BN.arm.ik(dm.P[i], q[1] >= 0 ? 1 : -1, w.body);
    const u0 = clip(KST * (target[0] - q[0])), u1 = clip(KST * (target[1] - q[1]));
    q[0] += DT * (u0 * me.gain + GUST * BN.randn(rng)); q[1] += DT * (u1 * me.gain + GUST * BN.randn(rng));
  }
  return 'tout';
}
function wilson(k, n) { const z = 1.96, p = k / n, d = 1 + z * z / n, c = (p + z * z / (2 * n)) / d, h = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d; return [Math.max(0, c - h), Math.min(1, c + h)]; }
/* success of a pooled set on the test layouts.  own, foreign: arrays of demonstrations; w: trust in foreign layouts */
function pooled(own, foreign, w, space, tests, evseed) {
  let ok = 0, co = 0, usedF = 0, nOwnNearest = 0;
  tests.forEach((th, k) => {
    let best = null, bd = Infinity, isOwn = true;
    for (const d of own) { const x = dist(th, d.th); if (x < bd) { bd = x; best = d; isOwn = true; } }
    if (w > 0) for (const d of foreign) { const x = dist(th, d.th) / w; if (x < bd) { bd = x; best = d; isOwn = false; } }
    const r = follow(th, best, space, 1000 * evseed + k + 1);
    if (r === 'done') ok++; else if (r === 'coll') co++;
    if (isOwn) nOwnNearest++; else usedF++;
  });
  const N = tests.length, ci = wilson(ok, N);
  return { N, ok, succ: ok / N, coll: co / N, tout: (N - ok - co) / N, used: usedF / N, ownShare: nOwnNearest / N, lo: ci[0], hi: ci[1] };
}
/* the exchange rate, written separately: invert the rising envelope of your own curve */
function equiv(Ns, S, s) {
  const env = []; let m = 0; for (const x of S) { m = Math.max(m, x); env.push(m); }
  let pn = 0, ps = 0;
  for (let i = 0; i < Ns.length; i++) { if (s <= env[i]) return pn + (Ns[i] - pn) * (s - ps) / Math.max(1e-12, env[i] - ps); pn = Ns[i]; ps = env[i]; }
  const a = Ns.length - 1, sl = (Ns[a] - Ns[a - 1]) / Math.max(1e-12, env[a] - env[a - 1]);
  return Ns[a] + sl * (s - env[a]);
}
const GRID = [1, 2, 4, 8, 12, 16, 24, 32, 48, 64, 96, 128, 192, 256];
const MS = [0, 4, 8, 16, 32, 64, 128, 256];

/* ───── the typical draw the widget uses ───── */
const tests = layouts(NT, 99), EV = 5;
const ownTh = layouts(NFILE, 1011), forTh = layouts(NFILE, 2024);
const own = fileOf('A', ownTh, NFILE);
const files = {}; for (const k of ['twin', 'close', 'near', 'old']) files[k] = fileOf(k, forTh, NFILE);
check(own.length === NFILE, 'all of arm A\'s own demonstrations succeed');
put('old_kept_256', files.old.length, 0);
{ let fails = 0, fc = 0; for (let k = 0; k < NFILE; k++) { const d = record(BODY.old, forTh[k], 500 + k); if (!d.ok) { fails++; if (d.coll) fc++; } } put('old_fail', fails, 0); put('old_fail_coll', fc, 0); check(fails + files.old.length === NFILE, 'kept + failed = attempted'); check(fc === fails, 'every failed attempt of the older arm is a collision'); }
const cur = { hand: GRID.map((n) => pooled(own.slice(0, n), [], 0, 'hand', tests, EV).succ), joint: GRID.map((n) => pooled(own.slice(0, n), [], 0, 'joint', tests, EV).succ) };
const SET = (na, body, m, w, space) => pooled(own.slice(0, na), m ? files[body].filter((d) => d.k < m) : [], w, space, tests, EV);
const RATE = (na, m, s, space) => (equiv(GRID, cur[space], s) - na) / m;
put('own16', cur.hand[GRID.indexOf(16)] * 100, 1); put('own16_joint', cur.joint[GRID.indexOf(16)] * 100, 1);
put('own64', cur.hand[GRID.indexOf(64)] * 100, 1); put('own32', cur.hand[GRID.indexOf(32)] * 100, 1);

/* ───── 1. the entry: what A's own layouts buy, over twelve draws ───── */
const NG = [1, 2, 4, 8, 12, 16, 24, 32, 48, 64, 80, 96, 112, 128, 160, 192, 256];
function n90(Ns, S) { for (let i = 1; i < Ns.length; i++) if (S[i] >= 0.9) { const a = Math.log(Ns[i - 1]), b = Math.log(Ns[i]); return Math.exp(a + (b - a) * (0.9 - S[i - 1]) / (S[i] - S[i - 1])); } return NaN; }
const DRAWS = 12;
const draws = [];
for (let d = 0; d < DRAWS; d++) {
  const oT = layouts(NFILE, 1000 + d), fT = layouts(NFILE, 3000 + d), oF = fileOf('A', oT, NFILE);
  const fl = { near: fileOf('near', fT, NFILE), close: fileOf('close', fT, NFILE), twin: fileOf('twin', fT, NFILE), old: fileOf('old', fT, NFILE) };
  const c = NG.map((n) => pooled(oF.slice(0, n), [], 0, 'hand', tests, EV).succ);
  const cg = GRID.map((n) => pooled(oF.slice(0, n), [], 0, 'hand', tests, EV).succ);
  const at = (body, m, w, space, na) => pooled(oF.slice(0, na || 16), fl[body].filter((x) => x.k < m), w, space, tests, EV);
  const rec = { c, cg };
  for (const [body, space] of [['near', 'hand'], ['near', 'joint'], ['close', 'hand'], ['close', 'joint'], ['twin', 'hand'], ['twin', 'joint'], ['old', 'hand']]) {
    const r = at(body, 64, 1, space); rec[body + '_' + space] = r.succ;
    const cj = space === 'joint' ? GRID.map((n) => pooled(oF.slice(0, n), [], 0, 'joint', tests, EV).succ) : cg;
    rec['r_' + body + '_' + space] = (equiv(GRID, cj, r.succ) - 16) / 64;
  }
  rec.own16 = cg[GRID.indexOf(16)];
  // one dimension: shift only (tilt 0), own layouts and tests on the same line
  const tests1 = tests.map((t) => [t[0], 0]), oT1 = oT.map((t) => [t[0], 0]), oF1 = fileOf('A', oT1, NFILE);
  rec.c1 = NG.map((n) => pooled(oF1.slice(0, n), [], 0, 'hand', tests1, EV).succ);
  draws.push(rec);
}
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const sd = (a) => { const m = mean(a); return Math.sqrt(a.reduce((x, y) => x + (y - m) * (y - m), 0) / (a.length - 1)); };
const meanCurve = NG.map((_, i) => mean(draws.map((d) => d.c[i]))), meanCurve1 = NG.map((_, i) => mean(draws.map((d) => d.c1[i])));
put('n90_mean', n90(NG, meanCurve), 1); put('n90_d1', n90(NG, meanCurve1), 1);
const per90 = draws.map((d) => n90(NG, d.c)); put('n90_lo', Math.min(...per90), 0); put('n90_hi', Math.max(...per90), 0);
put('rho', F.n90_mean / F.n90_d1, 1);
put('own16_mean', mean(draws.map((d) => d.own16)) * 100, 1); put('own16_sd', sd(draws.map((d) => d.own16)) * 100, 1);
put('own16_lo', Math.min(...draws.map((d) => d.own16)) * 100, 1); put('own16_hi', Math.max(...draws.map((d) => d.own16)) * 100, 1);
const SEC_LAYOUT = 9.3 + 20 + 120;                          // expert_s from lesson 1, 20 s to put the cup back, 120 s to rebuild a layout
put('sec_per_layout', SEC_LAYOUT, 1); put('hours_n90', F.n90_mean * SEC_LAYOUT / 3600, 1); put('min_own16', 16 * SEC_LAYOUT / 60, 0);
// the cost of more numbers per layout, if each further number costs the same factor rho
const N90d = (d) => F.n90_mean * Math.pow(F.rho, d - 2);
put('n90_d3', N90d(3), 0); put('n90_d4', N90d(4), 0); put('n90_d5', N90d(5), 0); put('n90_d6', N90d(6), 0); put('n90_d7', N90d(7), 0); put('n90_d8', N90d(8), 0);
put('n90_d2', N90d(2), 0); for (let d = 2; d <= 7; d++) { put('hours_d' + d, N90d(d) * SEC_LAYOUT / 3600, d === 2 ? 1 : 0); put('pct_d' + d, N90d(d) / 1e6 * 100, d <= 3 ? 3 : (d <= 5 ? 1 : 0)); }
put('hours_d3', N90d(3) * SEC_LAYOUT / 3600, 0); put('hours_d4', N90d(4) * SEC_LAYOUT / 3600, 0); put('weeks_d4', N90d(4) * SEC_LAYOUT / 3600 / 40, 1);
let dmax = 2; while (N90d(dmax + 1) <= 1e6) dmax++; put('d_cover', dmax, 0);
put('rho_l7', 5.8, 1);                                       // the per-number factor lesson 7 derives from footprints: quoted from that lesson, not computed here
{ let d7 = 2; while (F.n90_mean * Math.pow(F.rho_l7, d7 + 1 - 2) <= 1e6) d7++; put('d_cover_l7', d7, 0); check(d7 === F.d_cover + 1, 'at lesson 7\'s factor the pool covers one more number than at the measured factor (' + d7 + ' vs ' + F.d_cover + ')'); }
put('oxe_traj', 1e6, 0);
put('pool_hours', 2000 + 2976.4 + 10000, 0); put('person_years', (2000 + 2976.4 + 10000) / 365, 0);

/* ───── 2. what a joint-angle label says to another arm ───── */
const clr = []; for (const d of own.slice(0, 64)) { const w = worldOf(d.th, BODY.A); let b = 9; for (const p of d.P) for (const c of w.posts) b = Math.min(b, Math.hypot(p[0] - c[0], p[1] - c[1])); clr.push((b - 0.05) * 100); }
put('clear_mean', mean(clr), 2); put('clear_min', Math.min(...clr), 2);
function gapOf(key, count) {                                 // A tracks the other arm's stored joint angles: where does A's hand go, against where the other hand went (cm)
  const out = []; let maxFormula = 0, q2s = 0, q2n = 0, amp = 0;
  for (const d of files[key].slice(0, count)) {
    let s = 0;
    for (let i = 0; i < d.n; i++) {
      const a = BN.arm.fk(d.Q[i], BODY.A), g = Math.hypot(a[0] - d.P[i][0], a[1] - d.P[i][1]); s += g;
      const delta = BODY[key].L1 - BODY.A.L1, f = 2 * Math.abs(delta) * Math.sin(Math.abs(d.Q[i][1]) / 2);
      maxFormula = Math.max(maxFormula, Math.abs(g - f)); q2s += d.Q[i][1]; q2n++; amp += 2 * Math.sin(Math.abs(d.Q[i][1]) / 2);
    }
    out.push(s / d.n);
  }
  return { mean: mean(out) * 100, formulaErr: maxFormula, q2: q2s / q2n * 180 / Math.PI, amp: amp / q2n };
}
const gTwin = gapOf('twin', 16), gClose = gapOf('close', 16), gNear = gapOf('near', 16);
put('gap_twin', gTwin.mean, 2); put('gap_close', gClose.mean, 1); put('gap_near', gNear.mean, 1);
check(gTwin.formulaErr < 1e-12 && gClose.formulaErr < 1e-9 && gNear.formulaErr < 1e-9, 'the displacement of a joint label is exactly 2 |d| sin(q2/2) (largest deviation ' + Math.max(gClose.formulaErr, gNear.formulaErr) + ')');
put('gap_close_max', Math.max(...files.close.slice(0, 16).map((d) => Math.max(...d.Q.map((q, i) => { const a = BN.arm.fk(q, BODY.A); return Math.hypot(a[0] - d.P[i][0], a[1] - d.P[i][1]); })))) * 100, 1);
put('gap_near_max', Math.max(...files.near.slice(0, 16).map((d) => Math.max(...d.Q.map((q, i) => { const a = BN.arm.fk(q, BODY.A); return Math.hypot(a[0] - d.P[i][0], a[1] - d.P[i][1]); })))) * 100, 1);
put('q2_deg', gNear.q2, 0); put('amp', gNear.amp, 2);                            // elbow angle along the course, and the factor 2 sin(q2/2)
put('tol_link_cm', F.clear_mean / F.amp, 2); put('tol_link_pct', F.tol_link_cm / 50 * 100, 1);
// the same story for a velocity label: the angle between the motion A's joints make under the other arm's command and the motion the other hand made
function angleOf(key, count) {
  const out = [];
  for (const d of files[key].slice(0, count)) {
    const wB = worldOf(d.th, BODY[key]);
    for (let i = 0; i < d.n; i += 3) {
      const u = BN.slalom.expertAct(wB, d.Q[i]); if (Math.hypot(u[0], u[1]) < 1e-6) continue;
      const JB = BN.arm.jac(d.Q[i], BODY[key]), vB = [JB[0] * u[0] + JB[1] * u[1], JB[2] * u[0] + JB[3] * u[1]];
      const qa = BN.arm.ik(d.P[i], d.Q[i][1] >= 0 ? 1 : -1, BODY.A), JA = BN.arm.jac(qa, BODY.A), vA = [JA[0] * u[0] + JA[1] * u[1], JA[2] * u[0] + JA[3] * u[1]];
      const c = (vA[0] * vB[0] + vA[1] * vB[1]) / (Math.hypot(vA[0], vA[1]) * Math.hypot(vB[0], vB[1]));
      out.push(Math.acos(Math.max(-1, Math.min(1, c))) * 180 / Math.PI);
    }
  }
  return mean(out);
}
put('angle_twin', angleOf('twin', 16), 1); put('angle_close', angleOf('close', 16), 1); put('angle_near', angleOf('near', 16), 1);
{ const COURSE = 110; for (const k of ['twin', 'close', 'near']) put('drift_' + k, COURSE * Math.tan(angleOf(k, 16) * Math.PI / 180), 1); }       // a rotation of the hand's direction, integrated over the 1.1 m of the course

/* ───── 3. three ways to pool (own 16, 64 foreign layouts of the arm with links 0.55 + 0.45) ───── */
const jn = SET(16, 'near', 64, 1, 'joint'), hn = SET(16, 'near', 64, 1, 'hand'), tag = SET(16, 'near', 64, 0, 'joint');
put('joint_near64', jn.succ * 100, 1); put('hand_near64', hn.succ * 100, 1); put('tag_near64', tag.succ * 100, 1);
put('coll_joint_near64', jn.coll * 100, 0); put('used_joint_near64', jn.used * 100, 0); put('own_share', hn.ownShare * 100, 1); put('share_pred', 16 / 80 * 100, 0);
put('pred_joint_near64', hn.succ * 16 / 80 * 100, 1);
const jc = SET(16, 'close', 64, 1, 'joint'); put('joint_close64', jc.succ * 100, 1);
const hc = SET(16, 'close', 64, 1, 'hand'); put('hand_close64', hc.succ * 100, 1);
const jt = SET(16, 'twin', 64, 1, 'joint'), ht = SET(16, 'twin', 64, 1, 'hand'); put('joint_twin64', jt.succ * 100, 1); put('hand_twin64', ht.succ * 100, 1);
// the closed form, for every foreign count: joint success = hand success x N / (N + M)
let worstShare = 0, worseEvery = true, bestEvery = true;
const near = { joint: [], hand: [] };
for (const m of MS) { near.joint.push(SET(16, 'near', m, 1, 'joint').succ); near.hand.push(SET(16, 'near', m, 1, 'hand').succ); }
MS.forEach((m, i) => { if (m) { worstShare = Math.max(worstShare, Math.abs(near.joint[i] - near.hand[i] * 16 / (16 + m))); if (!(near.joint[i] < cur.joint[GRID.indexOf(16)])) worseEvery = false; if (!(near.hand[i] > cur.hand[GRID.indexOf(16)])) bestEvery = false; } });
put('share_dev_max', worstShare * 100, 1);
check(worstShare < 0.045, 'joint success = hand success x N/(N+M) within 4.5 points for every M (got ' + (worstShare * 100).toFixed(1) + ')');
check(worseEvery, 'joint labels from the 0.55 + 0.45 arm give less than no foreign data at every M > 0');
check(bestEvery, 'hand labels from the 0.55 + 0.45 arm give more than no foreign data at every M > 0');
check(Math.abs(hn.ownShare - 16 / 80) < 0.03, 'the nearest layout is one of your own with probability N/(N+M) = 0.2 (got ' + hn.ownShare + ')');
check(Math.abs(tag.succ - cur.joint[GRID.indexOf(16)]) < 1e-9, 'a body tag (weight 0) leaves success where own data put it');
for (let x = 0.1; x < 12; x += 0.1) check((1 - Math.exp(-x)) / x > (1 - Math.exp(-x - 0.1)) / (x + 0.1), 'the share law is decreasing at ' + x);
put('hand_near64_lo', hn.lo * 100, 1); put('hand_near64_hi', hn.hi * 100, 1); put('joint_near64_lo', jn.lo * 100, 1); put('joint_near64_hi', jn.hi * 100, 1);
put('delta_hand_near64', (hn.succ - cur.hand[5]) * 100, 1); put('share_256', 16 / 272 * 100, 1);
put('hand_near256', near.hand[MS.indexOf(256)] * 100, 1); put('joint_near256', near.joint[MS.indexOf(256)] * 100, 1);
put('hand_near32', near.hand[MS.indexOf(32)] * 100, 1);

/* how many foreign layouts bring 16 own ones to ninety percent, against what own layouts alone need (this draw) */
put('n90_typ', n90(GRID, cur.hand), 0);
{ let m90 = NaN; for (let m = 16; m <= 256; m += 8) if (SET(16, 'near', m, 1, 'hand').succ >= 0.9) { m90 = m; break; } put('m90', m90, 0); put('n90_pooled', 16 + m90, 0); }
/* ───── 4. exchange rates, single draw and twelve draws ───── */
put('neq_hand_near64', equiv(GRID, cur.hand, hn.succ), 0); put('neq_joint_near64', equiv(GRID, cur.joint, jn.succ), 1); put('lost_joint_near64', 16 - F.neq_joint_near64, 1); put('r_hand_near64', RATE(16, 64, hn.succ, 'hand'), 2); put('r_hand_twin64', RATE(16, 64, ht.succ, 'hand'), 2); put('r_hand_close64', RATE(16, 64, hc.succ, 'hand'), 2);
put('r_joint_near64', RATE(16, 64, jn.succ, 'joint'), 2); put('r_joint_close64', RATE(16, 64, jc.succ, 'joint'), 2); put('r_joint_twin64', RATE(16, 64, jt.succ, 'joint'), 2);
const ho = SET(16, 'old', 64, 1, 'hand'); put('hand_old64', ho.succ * 100, 1); put('r_hand_old64', RATE(16, 64, ho.succ, 'hand'), 2);
for (const k of ['near_hand', 'near_joint', 'close_hand', 'twin_hand', 'twin_joint', 'old_hand']) { const a = draws.map((d) => d['r_' + k]); put('rm_' + k, mean(a), 2); put('rlo_' + k, Math.min(...a), 2); put('rhi_' + k, Math.max(...a), 2); }
put('hand_near_mean64', mean(draws.map((d) => d.near_hand)) * 100, 1); put('joint_near_mean64', mean(draws.map((d) => d.near_joint)) * 100, 1);
put('base_mean16', F.own16_mean, 1);
check(draws.every((d) => d.near_joint < d.own16 - 0.05), 'on every one of twelve draws joint labels from the 0.55 + 0.45 arm leave A far below its own-data success');
check(draws.every((d) => d.close_joint < d.own16 - 0.02), 'on every one of twelve draws joint labels from the 0.51 + 0.49 arm leave A below its own-data success');
check(draws.every((d) => d.near_hand > d.own16 + 0.25), 'on every draw hand labels lift A by more than 25 points at 64 foreign layouts');
check(F.rm_near_hand > 0.8 && F.rm_near_hand < 1.2 && F.rm_twin_hand > 0.8 && F.rm_twin_hand < 1.2, 'in the hand\'s space a foreign layout is worth about one of your own (' + F.rm_near_hand + ', ' + F.rm_twin_hand + ')');
check(F.rm_near_joint < 0 && F.rm_close_hand > 0.8, 'in joint angles a foreign layout is worth less than nothing');
check(F.rm_old_hand > 0.1 && F.rm_old_hand < 0.6, 'an older arm\'s layouts are worth between 0.1 and 0.6 of yours (got ' + F.rm_old_hand + ')');
check(Math.abs(F.rm_twin_joint - F.rm_twin_hand) < 0.15, 'for an arm of the same make joint and hand labels give the same exchange rate');

/* ───── 5. interference: an older arm ───── */
function atDistance(list, count) {                           // A follows one stored layout at (almost) the layout it was recorded on, 4 test layouts each at distance below 1.2 cm
  let ok = 0, co = 0, to = 0, n = 0;
  list.slice(0, count).forEach((d, i) => {
    for (let k = 0, f = 0; k < tests.length && f < 4; k++) { if (dist(tests[k], d.th) > 0.012) continue; f++; const r = follow(tests[k], d, 'hand', 7000 + i * 10 + f); n++; if (r === 'done') ok++; else if (r === 'coll') co++; else to++; }
  });
  return { n, ok: ok / n * 100, coll: co / n * 100, tout: to / n * 100 };
}
const d0 = atDistance(own, 60), d1 = atDistance(files.old, 60);
put('near0_own', d0.ok, 0); put('near0_old', d1.ok, 0); put('near0_old_coll', d1.coll, 0); put('near0_old_tout', d1.tout, 0); put('near0_old_n', d1.n, 0);
// the two things that are the older arm's own, taken apart: a slower, later plant without extra gust, and the extra gust alone
{ const VAR = { tempo: { L1: 0.5, L2: 0.5, rgain: 0.85, lag: 0.1 }, wobble: { L1: 0.5, L2: 0.5, noise: 0.12 } };
  for (const k of Object.keys(VAR)) {
    const list = []; for (let i = 0; i < NFILE; i++) { const d = record(VAR[k], forTh[i], 500 + i); if (d.ok) list.push(d); }
    const r = atDistance(list, 60);
    put(k + '_kept', list.length, 0); put(k + '_frames', mean(list.slice(0, 60).map((d) => d.n)), 0); put(k + '_over_T', list.slice(0, 60).filter((d) => d.n > BN.slalom.horizon(worldOf([0, 0], BODY.A))).length, 0);
    put(k + '_ok', r.ok, 0); put(k + '_coll', r.coll, 0); put(k + '_tout', r.tout, 0);
  }
  check(F.tempo_over_T === 0 && F.tempo_ok >= 97, 'a slower, lagged plant alone stays inside A\'s allowance and A completes its runs (' + F.tempo_ok + ' %)');
  check(F.wobble_coll >= 10 && F.wobble_tout <= 3, 'the extra gust alone costs collisions, not time (' + F.wobble_coll + ' % collisions, ' + F.wobble_tout + ' % out of steps)'); }
put('old_frames', mean(files.old.map((d) => d.n)), 0); put('own_frames', mean(own.map((d) => d.n)), 0); put('horizon', BN.slalom.horizon(worldOf([0, 0], BODY.A)), 0);
put('old_over_T', files.old.filter((d) => d.n > F.horizon).length / files.old.length * 100, 0);
const sweep = (na, m) => { const o = []; for (let w = 0; w <= 1.0001; w += 0.1) o.push(SET(na, 'old', m, Math.round(w * 10) / 10, 'hand').succ); return o; };
const sw64 = sweep(64, 64), sw16 = sweep(16, 64);
const argmax = (a) => { let b = 0; a.forEach((x, i) => { if (x > a[b] + 1e-12) b = i; }); return b; };
put('w_best64', argmax(sw64) / 10, 1); put('succ_best64', sw64[argmax(sw64)] * 100, 1); put('succ_w1_64', sw64[10] * 100, 1); put('succ_w0_64', sw64[0] * 100, 1); put('succ_w6_64', sw64[6] * 100, 1);
put('w_best16', argmax(sw16) / 10, 1); put('succ_best16', sw16[argmax(sw16)] * 100, 1); put('succ_w1_16', sw16[10] * 100, 1);
put('gain_best64', F.succ_best64 - F.succ_w1_64, 1); put('cost_w1_64', F.succ_w0_64 - F.succ_w1_64, 1); put('gain_best64_none', F.succ_best64 - F.succ_w0_64, 1);
check(d0.ok >= 97, 'A following its own layout nearly exactly completes the course (' + d0.ok + ' %)');
check(d1.ok < 80 && d1.ok > 40, 'an older arm\'s demonstration followed at distance below 1.2 cm completes the course between 40 and 80 % of the time (got ' + d1.ok + ')');
check(F.w_best64 >= 0.3 && F.w_best64 <= 0.8 && F.gain_best64 >= 2, 'with 64 own layouts the best weight for the older arm is between 0.3 and 0.8 and beats weight 1 by at least 2 points (' + F.w_best64 + ', +' + F.gain_best64 + ')');
check(F.succ_w1_64 < F.succ_w0_64 + 2, 'at weight 1 the older arm\'s layouts buy A at most 2 points over its own 64 layouts');
check(F.succ_best16 > F.succ_w0_64 - 100 && F.w_best16 >= 0.7, 'with 16 own layouts the older arm deserves a weight of at least 0.7 (' + F.w_best16 + ')');

/* ───── the checkpoint exercise, by hand ───── */
put('ck_gap', 2 * 0.03 * Math.sin(Math.PI / 4) * 100, 1); put('ck_delta', 1.3 / (2 * Math.sin(Math.PI / 4)), 2); put('ck_pct', F.ck_delta / 50 * 100, 1);
put('ck_neq', 70, 0); put('ck_rate', (70 - 16) / 64, 2);
{ const mc = GRID.map((_, i) => mean(draws.map((d) => d.cg[i]))); const dev = draws.map((d) => [3, 5, 7, 9].reduce((a, i) => a + (d.cg[i] - mc[i]) ** 2, 0)); const best = dev.indexOf(Math.min(...dev));
  check(best === 11, 'the draw the widget uses (own layouts from seed 1011, the twelfth) is the one of twelve whose curve lies nearest the mean (got draw ' + best + ')'); }
check(Math.abs(BN.slalom.xEnd(worldOf([0, 0], BODY.A)) - BN.slalom.xStart() - 1.1) < 1e-9, 'the hand travels 1.1 m along the course');
/* ───── checks of the entry claims ───── */
check(F.n90_mean > 90 && F.n90_mean < 130, 'ninety percent costs about a hundred layouts when two numbers describe a layout (' + F.n90_mean + ')');
check(F.rho > 4 && F.rho < 12, 'one more number multiplies the count by 4 to 12 (' + F.rho + ')');
check(F.own16 > 28 && F.own16 < 42, 'the typical draw sits near the mean at 16 layouts (' + F.own16 + ' vs ' + F.own16_mean + ')');
check(F.d_cover >= 5 && F.d_cover <= 7, 'the largest pool named covers scenes of five to seven numbers (' + F.d_cover + ')');

/* ───── the engine and the widget agree with all of this ───── */
const BLpath = path.join(root, dir, 'bodies_lab.js');
if (fs.existsSync(BLpath)) {
  globalThis.BN = BN; const BL = require(BLpath);
  const eq = (a, b, m) => { if (Math.abs(a - b) > 1e-9) fail('engine vs independent: ' + m + ' ' + a + ' vs ' + b); };
  eq(BL.setting({ na: 16, body: 'near', m: 64, w: 1, space: 'hand' }).succ, hn.succ, 'near hand 64');
  eq(BL.setting({ na: 16, body: 'near', m: 64, w: 1, space: 'joint' }).succ, jn.succ, 'near joint 64');
  eq(BL.setting({ na: 16, body: 'old', m: 64, w: 1, space: 'hand' }).succ, ho.succ, 'old hand 64');
  eq(BL.setting({ na: 64, body: 'old', m: 64, w: 0.6, space: 'hand' }).succ, sw64[6], 'old hand 64 own 64 w 0.6');
  eq(BL.setting({ na: 16, body: 'twin', m: 256, w: 1, space: 'joint' }).succ, SET(16, 'twin', 256, 1, 'joint').succ, 'twin joint 256');
  eq(BL.ownCurve('hand').s[5], cur.hand[5], 'own curve at 16');
  eq(BL.exchangeRate(BL.ownCurve('hand'), 16, 64, hn.succ), RATE(16, 64, hn.succ, 'hand'), 'exchange rate');
  eq(BL.gap('near') * 100, gapOf('near', 16).mean, 'gap near');
}
const html = path.join(root, dir, '08_other_bodies.html');
if (fs.existsSync(html)) {
  const pg = loadPage(html);
  pg.problems.forEach((p) => fail('page problem: ' + p));
  const eqd = (id, want, digits, what) => { const got = pg.num(id); if (!(Math.abs(got - want) <= 0.5 * Math.pow(10, -digits) + 1e-9)) fail(`${what}: widget #${id} prints ${got}, independent computation gives ${want.toFixed(digits + 2)}`); };
  const state = (m, w, space, body, na) => { pg.set('w08-space', space); pg.set('w08-body', body); pg.set('w08-na', na); pg.set('w08-w', w); pg.set('w08-m', MS.indexOf(m)); pg.drain(); };
  const probe = (r, base, rate, tag) => { eqd('w08-succ', r.succ * 100, 1, tag + ' success'); eqd('w08-base', base * 100, 1, tag + ' own-data success'); eqd('w08-delta', (r.succ - base) * 100, 1, tag + ' gain'); eqd('w08-used', r.used * 100, 0, tag + ' share on foreign layouts');
    eqd('w08-coll', r.coll * 100, 0, tag + ' collisions'); eqd('w08-tout', r.tout * 100, 0, tag + ' timeouts'); if (rate !== null) eqd('w08-rate', rate, 2, tag + ' exchange rate'); };
  state(64, 1, 'hand', 'near', 16); probe(hn, cur.hand[5], F.r_hand_near64, 'default (hand labels, near, 64)');
  eqd('w08-gap', 0, 1, 'default label gap in the hand\'s space');
  state(64, 1, 'joint', 'near', 16); probe(jn, cur.joint[5], F.r_joint_near64, 'joint labels, near, 64'); eqd('w08-gap', F.gap_near, 1, 'label gap, near');
  state(64, 1, 'joint', 'close', 16); probe(jc, cur.joint[5], F.r_joint_close64, 'joint labels, close, 64'); eqd('w08-gap', F.gap_close, 1, 'label gap, close');
  state(64, 1, 'joint', 'twin', 16); probe(jt, cur.joint[5], F.r_joint_twin64, 'joint labels, twin, 64'); eqd('w08-gap', F.gap_twin, 1, 'label gap, twin');
  state(64, 0, 'joint', 'near', 16); probe(tag, cur.joint[5], null, 'weight 0, joint labels');
  state(256, 1, 'hand', 'near', 16); probe(SET(16, 'near', 256, 1, 'hand'), cur.hand[5], RATE(16, 256, near.hand[7], 'hand'), 'hand labels, near, 256');
  state(64, 1, 'hand', 'old', 16); probe(ho, cur.hand[5], F.r_hand_old64, 'older arm, 64'); eqd('w08-kept', files.old.filter((d) => d.k < 64).length, 0, 'older arm, kept demonstrations');
  state(64, 1, 'hand', 'old', 64); probe(SET(64, 'old', 64, 1, 'hand'), cur.hand[ GRID.indexOf(64)], null, 'older arm, own 64, weight 1');
  state(64, 0.6, 'hand', 'old', 64); probe(SET(64, 'old', 64, 0.6, 'hand'), cur.hand[GRID.indexOf(64)], null, 'older arm, own 64, weight 0.6'); eqd('w08-best', F.w_best64, 1, 'best weight, older arm, own 64');
  state(0, 1, 'hand', 'near', 16); eqd('w08-succ', cur.hand[5] * 100, 1, 'no foreign layouts');
}

console.log(JSON.stringify({ facts: F }));
process.exit(bad ? 1 : 0);
