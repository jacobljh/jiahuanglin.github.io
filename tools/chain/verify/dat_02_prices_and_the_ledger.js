#!/usr/bin/env node
'use strict';
/* Oracle for embodied_training_data lesson 02 (what an hour costs: prices and the ledger).
 * Re-derives every number the lesson quotes with code written separately from price_lab.js and ledger.js:
 *   prices     by campaign accounting (spend a budget over a stretch of wall-clock, divide by the hours that come out), not by the formula of LG.price / PL.price;
 *   rates      the layouts cells (own curves in both label spaces, every source at the operating points the lesson quotes, other simulator gaps, twelve other draws of layouts)
 *              recomputed from bench.js with an independent recorder / follower / pooling / inversion, after rob_08_other_bodies.js plus the footage and simulator bodies of
 *              build_ledger.js; the contact and recover cells recomputed live from the copied engines (insertion_lab.js, dagger_lab.js);
 *   rankings, break-even rates, the duty cycle at which footage and the own hour swap, and the factor by which each assumption must move to reverse a pair (closed forms, each confirmed by a scan
 *              of the independent ledger just inside and just outside the value, and a scan that no other assumption reverses anything within a factor of 1000);
 *   arithmetic on the verified throughput numbers the lesson cites.
 * It then asserts every claim of the prose, drives the page's widget through the states the prose names and compares what it prints.  Last stdout line: {"facts": {...}}. */
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '../../../all_lessons');
const dir = fs.existsSync(path.join(root, 'embodied_training_data_new')) ? 'embodied_training_data_new' : 'embodied_training_data';
const BN = require(path.join(root, dir, 'bench.js'));
const LG = require(path.join(root, dir, 'ledger.js'));
const INS = require(path.join(root, dir, 'insertion_lab.js'));
const DL = require(path.join(root, dir, 'dagger_lab.js'));
const { loadPage } = require('../dom_probe.js');

let bad = 0;
const fail = (m) => { bad++; console.error('FAIL ' + m); };
const check = (c, m) => { if (!c) fail(m); };
const F = {};
const put = (k, v, d) => { F[k] = +(+v).toFixed(d === undefined ? 4 : d); };
const near = (a, b, tol, what) => { if (!(Math.abs(a - b) <= tol)) fail(what + ': ' + a + ' vs ' + b); };

/* ───────────────────────── 1. the layouts engine, written out independently ───────────────────────── */
const DT = 0.05, JIT = 0.01, GUST = 0.08, CH = 16, KST = 20, NT = 1000, NFILE = 256, EV = 5;
const BODY = {
  A: { L1: 0.5, L2: 0.5, gain: 0.85 }, twin: { L1: 0.5, L2: 0.5 },
  old: { L1: 0.5, L2: 0.5, rgain: 0.85, lag: 0.1, noise: 0.12 },
  video: { L1: 0.5, L2: 0.5, rgain: 0.85, lag: 0, noise: 0.12, labelNoise: 0.003 },
};
const simBody = (g) => ({ L1: 0.5 * (1 + g), L2: 0.5 * (1 - g) });
const clip = (x) => Math.max(-1.5, Math.min(1.5, x));
function layouts(n, seed) { const r = BN.rng(seed), out = []; for (let i = 0; i < n; i++) { const s = (2 * r() - 1) * 0.10, t = (2 * r() - 1) * 0.20; out.push([s, t]); } return out; }
const worldOf = (th, b) => BN.slalom.world(5, { shift: th[0], tilt: th[1], body: { L1: b.L1, L2: b.L2 } });
const postY = new Map();
function ys(th) { let v = postY.get(th); if (!v) { v = worldOf(th, BODY.A).posts.map((p) => p[1]); postY.set(th, v); } return v; }
function dist(a, b) { const ya = ys(a), yb = ys(b); let m = 0; for (let i = 0; i < 5; i++) m = Math.max(m, Math.abs(ya[i] - yb[i])); return m; }
function record(body, th, seed) {                           // one demonstration with the plant written out; the footage's hand positions carry tracker noise
  const w = worldOf(th, body), rng = BN.rng(seed), T = 2 * BN.slalom.horizon(w), g = body.rgain || 1, lag = body.lag || 0, nz = body.noise || 0, xe = BN.slalom.xEnd(w);
  const q = BN.slalom.startQ(w, JIT * BN.randn(rng)).slice(), v = [0, 0], Q = [], P = [];
  let coll = false, done = false;
  for (let t = 0; t < T; t++) {
    const p = BN.arm.fk(q, w.body); Q.push([q[0], q[1]]); P.push([p[0], p[1]]);
    if (BN.slalom.collide(w, p)) { coll = true; break; }
    if (p[0] > xe - 0.02) { done = true; break; }
    const u = BN.slalom.expertAct(w, q);
    for (let k = 0; k < 2; k++) { const c = clip(u[k]) * g; v[k] = lag > 0 ? v[k] + (DT / (lag + DT)) * (c - v[k]) : c; q[k] += DT * (v[k] + (nz ? nz * BN.randn(rng) : 0)); }
  }
  if (body.labelNoise) { const r = BN.rng(seed * 7 + 3); for (let i = 0; i < P.length; i++) { P[i][0] += body.labelNoise * BN.randn(r); P[i][1] += body.labelNoise * BN.randn(r); } }
  return { th, Q, P, n: Q.length, ok: done && !coll, coll, done, body };
}
function fileOf(body, thetas, m) { const out = []; for (let k = 0; k < m; k++) { const d = record(body, thetas[k], 500 + k); if (d.ok) { d.k = k; out.push(d); } } return out; }
function follow(th, dm, space, seed) {
  const me = BODY.A, w = worldOf(th, me), rng = BN.rng(seed), T = BN.slalom.horizon(w), xr = BN.slalom.xEnd(w) - 0.02;
  const q = BN.slalom.startQ(w, JIT * BN.randn(rng)).slice();
  let i0 = 0;
  for (let t = 0; t < T; t++) {
    const p = BN.arm.fk(q, w.body);
    if (BN.slalom.collide(w, p)) return 'coll';
    if (p[0] > xr) return 'done';
    const j = t % CH;
    if (j === 0) {
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
function pooled(own, foreign, w, space, tests) {
  let ok = 0;
  tests.forEach((th, k) => {
    let best = null, bd = Infinity;
    for (const d of own) { const x = dist(th, d.th); if (x < bd) { bd = x; best = d; } }
    if (w > 0) for (const d of foreign) { const x = dist(th, d.th) / w; if (x < bd) { bd = x; best = d; } }
    if (follow(th, best, space, 1000 * EV + k + 1) === 'done') ok++;
  });
  const ci = wilson(ok, tests.length);
  return { succ: ok / tests.length, lo: ci[0], hi: ci[1] };
}
function equiv(Ns, S, s) {                                    // the own-layout count that gives success s: running maximum of the own curve, linear in between, last segment extended
  const env = []; let mm = 0; for (const x of S) { mm = Math.max(mm, x); env.push(mm); }
  if (s <= 0) return 0;
  let pn = 0, ps = 0;
  for (let i = 0; i < Ns.length; i++) { if (s <= env[i]) return pn + (Ns[i] - pn) * (s - ps) / Math.max(1e-12, env[i] - ps); pn = Ns[i]; ps = env[i]; }
  const a = Ns.length - 1, sl = (Ns[a] - Ns[a - 1]) / Math.max(1e-12, env[a] - env[a - 1]);
  return Ns[a] + sl * (s - env[a]);
}
const GRID = [1, 2, 4, 8, 12, 16, 24, 32, 48, 64, 96, 128, 192, 256];
const SRC = { twin: [BODY.twin, 'hand'], old: [BODY.old, 'hand'], video: [BODY.video, 'hand'], 'sim0.001': [simBody(0.001), 'joint'], 'sim0.003': [simBody(0.003), 'joint'], 'sim0.01': [simBody(0.01), 'joint'],
  'sim0.015': [simBody(0.015), 'joint'], 'sim0.02': [simBody(0.02), 'joint'], 'sim0.03': [simBody(0.03), 'joint'], 'simH0.03': [simBody(0.03), 'hand'] };
const tests = layouts(NT, 99);
function drawOf(ownSeed, forSeed, count) {                    // a draw of layouts: the own file, the own curves, and a memoised source setting (base own layouts, m attempted)
  const own = fileOf(BODY.A, layouts(NFILE, ownSeed), NFILE), fT = layouts(NFILE, forSeed), files = {}, memo = {};
  const cur = { hand: GRID.map((n) => pooled(own.slice(0, n), [], 0, 'hand', tests).succ), joint: GRID.map((n) => pooled(own.slice(0, n), [], 0, 'joint', tests).succ) };
  const fileFor = (k) => files[k] || (files[k] = fileOf(SRC[k][0], fT, NFILE));
  return {
    own, cur, fT, fileFor,
    cell(k, base, m) {                                         // success with interval, kept count, and the exchange rate with its interval
      const key = k + '|' + base + '|' + m; if (memo[key]) return memo[key];
      const space = SRC[k][1], f = fileFor(k).filter((d) => d.k < m), r = pooled(own.slice(0, base), f, 1, space, tests), c = cur[space];
      const r4 = (x) => Math.round(x * 1e4) / 1e4, rho = (equiv(GRID, c, r.succ) - base) / m;
      return (memo[key] = { s: r.succ, lo: r.lo, hi: r.hi, kept: f.length, rho, rho4: r4(rho), rlo: (equiv(GRID, c, r.lo) - base) / m, rhi: (equiv(GRID, c, r.hi) - base) / m,
        rlo4: (equiv(GRID, c, r4(r.lo)) - base) / m, rhi4: (equiv(GRID, c, r4(r.hi)) - base) / m });   // the *4 variants read the 4-digit values the table stores, as the widget does
    },
  };
}

/* the table's draw (own layouts seed 1011, foreign 2024): every cell the lesson quotes, against the table of ledger.js */
const T0 = drawOf(1011, 2024);
check(T0.own.length === NFILE, 'all 256 of the own robot\'s demonstrations succeed (its discards are an assumption, not a measurement)');
const TL = LG.TABLE.layouts, MI = (m) => TL.M.indexOf(m);
GRID.forEach((n, i) => { near(T0.cur.hand[i], TL.ownHand.s[i], 6e-5, 'own curve (hand) at ' + n); near(T0.cur.joint[i], TL.ownJoint.s[i], 6e-5, 'own curve (joint) at ' + n); });
const POINTS = [[8, 64], [8, 16], [8, 256], [32, 64]];
const KEYS9 = ['twin', 'old', 'video', 'sim0.001', 'sim0.003', 'sim0.01', 'sim0.03', 'simH0.03'];
POINTS.forEach(([base, m]) => KEYS9.forEach((k) => {
  const c = T0.cell(k, base, m), t = TL.src[k];
  near(c.s, t.s[base][MI(m)], 6e-5, 'success ' + k + ' ' + base + '/' + m); near(c.rho, t.rho[base][MI(m)], 2e-4, 'rho ' + k + ' ' + base + '/' + m); check(c.kept === t.kept[base][MI(m)], 'kept ' + k + ' ' + base + '/' + m);
  near(c.lo, t.lo[base][MI(m)], 6e-5, 'lo ' + k); near(c.hi, t.hi[base][MI(m)], 6e-5, 'hi ' + k);
}));
const RHO = (k, base, m) => T0.cell(k, base, m).rho4;               // the rate as the table stores it (4 digits): the widget and the prose read the table
const tag = (k) => k.replace('sim', 's').replace('.', '');

/* ───────────────────────── 2. assumptions and prices, by campaign accounting ───────────────────────── */
const A = LG.assume;
const names = { wage: 'wage_per_h', arm: 'arm_cost', life: 'arm_life_h', duty: 'duty', discard: 'discard', rig: 'force_rig_cost', fduty: 'force_duty', curate: 'curate_per_h', vwage: 'video_wage_per_h', vduty: 'video_duty',
  vdisc: 'video_discard', track: 'track_per_h', gpu: 'gpu_per_h', speed: 'sim_speed', weeks: 'scene_weeks', wkcost: 'week_cost', uses: 'scene_uses_h', calib: 'calib_h', sduty: 'sup_duty' };
for (const k of Object.keys(names)) put('a_' + k, A[names[k]], 4);
/* a campaign: hire what the line needs for 1000 wall-clock hours, spend, and count the hours that come out */
function campaign(a) {
  const WALL = 1000, arm = a.arm_cost / a.arm_life_h;
  const own = { spend: WALL * (a.wage_per_h + arm), motion: WALL * a.duty };  own.kept = own.motion * (1 - a.discard); own.price = own.spend / own.kept;
  const vid = { spend: WALL * (a.video_wage_per_h + a.track_per_h), motion: WALL * a.video_duty }; vid.price = vid.spend / vid.motion;                    // per attempted hour
  const cur = { price: a.curate_per_h };
  const sceneSpend = a.scene_weeks * a.week_cost + (a.scene_uses_h * 3600 / a.sim_speed / 3600) * a.gpu_per_h + a.calib_h * own.price;                       // authoring + GPU-hours + calibration hours
  const sim = { spend: sceneSpend, hours: a.scene_uses_h, price: sceneSpend / a.scene_uses_h };
  const corr = { spend: WALL * (a.wage_per_h + arm), motion: WALL * a.sup_duty }; corr.price = corr.spend / corr.motion;
  const force = { spend: WALL * (a.wage_per_h + arm + a.force_rig_cost / a.arm_life_h), motion: WALL * a.force_duty }; force.kept = force.motion * (1 - a.discard); force.price = force.spend / force.kept;
  const force0 = { spend: WALL * (a.wage_per_h + arm), motion: WALL * a.force_duty }; force0.kept = force0.motion * (1 - a.discard); force0.price = force0.spend / force0.kept;
  return { own, vid, cur, sim, corr, force, force0, arm, scene: { authoring: a.scene_weeks * a.week_cost, gpuHours: a.scene_uses_h * 3600 / a.sim_speed / 3600 } };
}
const K0 = campaign(A);
put('arm_h', K0.arm, 4); put('wall_h', A.wage_per_h + K0.arm, 4); put('a_keep', 1 - A.discard, 4);
for (const [k, key] of [['duty', 'duty'], ['discard', 'discard'], ['fduty', 'force_duty'], ['sduty', 'sup_duty'], ['vduty', 'video_duty'], ['vdisc', 'video_discard']]) put('a_' + k + '_pct', A[key] * 100, 2);
put('arm_share', 100 * K0.arm / (A.wage_per_h + K0.arm), 2);
put('camp_spend', K0.own.spend, 0); put('camp_motion', K0.own.motion, 0); put('camp_kept', K0.own.kept, 0);
put('p_motion', K0.own.spend / K0.own.motion, 4);                       // per motion hour, before the discards
put('p_own', K0.own.price, 4); put('wage_ratio', K0.own.price / A.wage_per_h, 2);
put('p_demo', K0.own.price * 9.3 / 3600, 5); put('own_curve_total', K0.own.price * 256 * 9.3 / 3600, 4);
put('p_twin', K0.cur.price, 4); put('p_video', K0.vid.price, 4); put('p_video_kept', LG.price('video'), 4);
put('wall_per_motion', 1 / A.duty, 2); put('wall_per_kept', 1 / (A.duty * (1 - A.discard)), 2);
put('vid_spend', K0.vid.spend, 0); put('vid_motion', K0.vid.motion, 0); put('corr_motion', K0.corr.motion, 0); put('force_spend', K0.force.spend, 0); put('force_kept', K0.force.kept, 1);
put('sim_gpu_usd', K0.scene.gpuHours * A.gpu_per_h, 0); put('sim_calib_usd', A.calib_h * K0.own.price, 1); put('video_kept_frac', 1 - A.video_discard, 2);
put('p_sim', K0.sim.price, 5); put('sim_scene_usd', K0.sim.spend, 0); put('sim_authoring', K0.scene.authoring, 0); put('sim_gpu_hours', K0.scene.gpuHours, 0);
put('sim_gpu', A.gpu_per_h / A.sim_speed, 4); put('sim_auth', K0.scene.authoring / A.scene_uses_h, 4); put('sim_calib', A.calib_h * K0.own.price / A.scene_uses_h, 5);
put('sim_auth_share', 100 * (K0.scene.authoring / A.scene_uses_h) / K0.sim.price, 1); put('sim_gpu_share', 100 * (A.gpu_per_h / A.sim_speed) / K0.sim.price, 1);
put('p_corr', K0.corr.price, 4); put('p_force', K0.force.price, 4); put('p_force0', K0.force0.price, 4);
put('force_rig_h', A.force_rig_cost / A.arm_life_h, 4); put('force_rig_share', 100 * (A.force_rig_cost / A.arm_life_h) / (A.wage_per_h + K0.arm + A.force_rig_cost / A.arm_life_h), 1);
put('force_ratio', K0.force.price / K0.own.price, 2); put('force_premium', K0.force.price - K0.own.price, 2); put('force_premium_slow', K0.force0.price - K0.own.price, 2); put('force_premium_rig', K0.force.price - K0.force0.price, 2);
put('force_slow_share', 100 * (K0.force0.price - K0.own.price) / (K0.force.price - K0.own.price), 0);
/* the three prices LG.price and the campaign must agree on, and the one they differ on (footage: LG.price charges the discard that the rate already contains) */
near(K0.own.price, LG.price('own'), 1e-9, 'own price'); near(K0.cur.price, LG.price('twin'), 1e-9, 'twin price'); near(K0.sim.price, LG.price('sim'), 1e-9, 'sim price');
near(K0.corr.price, LG.price('corr'), 1e-9, 'corr price'); near(K0.force.price, LG.price('force'), 1e-9, 'force price');
near(LG.price('video') * (1 - A.video_discard), K0.vid.price, 1e-9, 'LG.price(video) = price per attempted hour / (1 - discard): the discard is in it');
put('video_kept_share', 100 * (1 - A.video_discard), 0);

/* ───────────────────────── 3. rates, costs per useful hour, break-even rates ───────────────────────── */
const P = { own: K0.own.price, twin: K0.cur.price, old: K0.cur.price, video: K0.vid.price, sim: K0.sim.price };
const pOf = (k) => (k.startsWith('sim') ? P.sim : P[k]);
const cost = (p, rho) => (rho > 0 ? p / rho : Infinity);
const putc = (k, v, d) => { if (isFinite(v)) put(k, v, d === undefined ? 4 : d); };
for (const k of KEYS9) { put('rho_' + tag(k), RHO(k, 8, 64), 4); putc('c_' + tag(k), cost(pOf(k), RHO(k, 8, 64))); put('kept_' + tag(k), T0.cell(k, 8, 64).kept, 0); put('be_' + tag(k), pOf(k) / P.own, 5); }
put('c_own', P.own, 4);
['twin', 'old', 'video', 'sim0.01'].forEach((k) => { for (const [base, m] of POINTS.slice(1)) { put(`rho_${tag(k)}_${base}_${m}`, RHO(k, base, m), 4); putc(`c_${tag(k)}_${base}_${m}`, cost(pOf(k), RHO(k, base, m))); } });
{ const cl = (k) => T0.cell(k, 8, 64);
  putc('c_video_ci_lo', cost(P.video, cl('video').rhi4)); putc('c_video_ci_hi', cost(P.video, cl('video').rlo4)); put('rho_video_lo', cl('video').rlo4, 4); put('rho_video_hi', cl('video').rhi4, 4);
  putc('c_twin_ci_lo', cost(P.twin, cl('twin').rhi4)); putc('c_twin_ci_hi', cost(P.twin, cl('twin').rlo4)); putc('c_old_ci_lo', cost(P.old, cl('old').rhi4)); putc('c_old_ci_hi', cost(P.old, cl('old').rlo4));
  putc('c_sim01_ci_lo', cost(P.sim, cl('sim0.01').rhi4)); putc('c_sim01_ci_hi', cost(P.sim, cl('sim0.01').rlo4)); }
put('c_video_double', LG.price('video') / RHO('video', 8, 64), 4); put('double_excess', 100 * (LG.price('video') / RHO('video', 8, 64) / cost(P.video, RHO('video', 8, 64)) - 1), 3);
put('worth_video', RHO('video', 8, 64) * P.own, 4); put('over_video', P.video - RHO('video', 8, 64) * P.own, 4); put('worth_old', RHO('old', 8, 64) * P.own, 4); put('worth_twin', RHO('twin', 8, 64) * P.own, 4);
put('ratio_old_twin', cost(P.old, RHO('old', 8, 64)) / cost(P.twin, RHO('twin', 8, 64)), 4);
put('ratio_twin_simh', cost(P.twin, RHO('twin', 8, 64)) / cost(P.sim, RHO('simH0.03', 8, 64)), 3);
put('ratio_price_twin_sim', P.twin / P.sim, 3); put('ratio_video_own', cost(P.video, RHO('video', 8, 64)) / P.own, 4); put('ratio_own_video_price', P.own / P.video, 4);
put('sim_loss_03', -RHO('sim0.03', 8, 64), 4);
/* claims of the prose at the default operating point */
const C64 = {}; ['twin', 'old', 'video', 'sim0.001', 'sim0.003', 'sim0.01', 'simH0.03'].forEach((k) => { C64[k] = cost(pOf(k), RHO(k, 8, 64)); });
check(P.video > P.twin && P.video > P.sim && P.twin >= P.sim, 'footage is dearer to make than the other borrowed hours');
check(C64.video > P.own && C64.video > C64.old && C64.video > C64.twin && C64.video > C64['sim0.001'], 'footage is the dearest useful hour of the layouts column (own, twin, older arm, footage, simulator)');
check(P.video < P.own, 'footage is cheaper than the own hour by price');
check(!(RHO('sim0.03', 8, 64) > 0), 'the 3 % simulator with joint labels has a rate at or below zero at (8, 64)');
check(C64['sim0.001'] < C64.twin && C64['sim0.003'] < C64.twin && C64['sim0.01'] < C64.twin && C64['simH0.03'] < C64.twin, 'the simulator is the cheapest useful hour while its rate is positive');
check(RHO('simH0.03', 8, 64) > 0.95 && RHO('twin', 8, 64) > 0.95 && Math.abs(RHO('simH0.03', 8, 64) - RHO('twin', 8, 64)) < 0.02, 'the twin arm and the 3 % simulator with hand labels have the same rate (about one)');
check(P.old === P.twin, 'the twin and the older arm have the same price');
check(RHO('video', 8, 64) < P.video / P.own, 'footage\'s rate is below its break-even rate');
check(RHO('old', 8, 64) > P.old / P.own && RHO('twin', 8, 64) > P.twin / P.own, 'the older arm and the twin are above their break-even rates');
put('sim_rate_floor', P.sim / C64.twin, 5);                  // the rate below which even the cheap simulator costs more per useful hour than the twin
check(F.sim_rate_floor > 0.01 && F.sim_rate_floor < 0.015, 'the simulator loses to the twin only below a rate of about 0.013');
/* the two orderings over the five rows of the widget (simulator at 1 %) */
const R5 = ['own', 'twin', 'old', 'video', 'sim0.01'].map((k) => ({ k, p: pOf(k), c: k === 'own' ? P.own : C64[k] }));
const ordering = (f) => R5.slice().sort((x, y) => f(x) - f(y)).map((r) => r.k);
check(ordering((r) => r.p).join(' < ') === 'sim0.01 < twin < old < video < own', 'ranking by price: ' + ordering((r) => r.p).join(' < '));
check(ordering((r) => r.c).join(' < ') === 'sim0.01 < twin < old < own < video', 'ranking by cost per useful hour: ' + ordering((r) => r.c).join(' < '));

/* ───────────────────────── 4. break-even duty, and the factor by which each assumption moves the ranking ───────────────────────── */
const A0 = LG.copyAssume();
function rowsAt(a, base, m, sim) {                           // an independent ledger: prices from the campaign, rates from the cells recomputed above
  const K = campaign(a), p = { own: K.own.price, twin: K.cur.price, old: K.cur.price, video: K.vid.price, sim: K.sim.price };
  return ['own', 'twin', 'old', 'video', sim].map((k) => { const rho = k === 'own' ? 1 : RHO(k, base, m), pp = k.startsWith('sim') ? p.sim : p[k]; return { k, p: pp, rho, c: cost(pp, rho) }; });
}
const orderAt = (a, base, m, sim) => rowsAt(a, base, m, sim).filter((r) => isFinite(r.c)).sort((x, y) => x.c - y.c).map((r) => r.k).join(' < ');
const REF = orderAt(A0, 8, 64, 'sim0.01');
/* closed forms: the value of one assumption at which two costs are equal, everything else at its default */
const arm0 = A0.arm_cost / A0.arm_life_h, keep0 = 1 - A0.discard, cV = C64.video, cO = C64.old, cT = C64.twin, rS = RHO('sim0.01', 8, 64), rV = RHO('video', 8, 64), rO = RHO('old', 8, 64);
const simRest = (skip) => ({ gpu: skip === 'gpu' ? 0 : A0.gpu_per_h / A0.sim_speed, auth: skip === 'auth' ? 0 : A0.scene_weeks * A0.week_cost / A0.scene_uses_h, cal: skip === 'cal' ? 0 : A0.calib_h * P.own / A0.scene_uses_h });
const target = cT * rS;                                      // the simulator's price at which its cost per useful hour equals the twin's
const CF = {
  duty:             { v: (A0.wage_per_h + arm0) / (keep0 * cV), dir: -1 },
  wage_per_h:       { v: cV * A0.duty * keep0 - arm0, dir: 1 },
  video_wage_per_h: { v: P.own * rV * A0.video_duty - A0.track_per_h, dir: -1 },
  curate_per_h:     { v: P.own * rO, dir: 1 },
  discard:          { v: 1 - (A0.wage_per_h + arm0) / (A0.duty * cV), dir: 1 },
  arm_cost:         { v: (cV * A0.duty * keep0 - A0.wage_per_h) * A0.arm_life_h, dir: 1 },
  arm_life_h:       { v: A0.arm_cost / (cV * A0.duty * keep0 - A0.wage_per_h), dir: -1 },
  scene_weeks:      { v: (target - simRest('x').gpu - simRest('x').cal) / (A0.week_cost / A0.scene_uses_h), dir: 1 },
  week_cost:        { v: (target - simRest('x').gpu - simRest('x').cal) / (A0.scene_weeks / A0.scene_uses_h), dir: 1 },
  scene_uses_h:     { v: (A0.scene_weeks * A0.week_cost + A0.calib_h * P.own) / (target - A0.gpu_per_h / A0.sim_speed), dir: -1 },
  gpu_per_h:        { v: (target - simRest('x').auth - simRest('x').cal) * A0.sim_speed, dir: 1 },
  sim_speed:        { v: A0.gpu_per_h / (target - simRest('x').auth - simRest('x').cal), dir: -1 },
};
const fkey = { duty: 'duty', wage_per_h: 'wage', video_wage_per_h: 'vwage', curate_per_h: 'curate', discard: 'discard', arm_cost: 'arm', arm_life_h: 'life', scene_weeks: 'weeks', week_cost: 'wkcost', scene_uses_h: 'uses', gpu_per_h: 'gpu', sim_speed: 'speed' };
const FL = {};
for (const k of Object.keys(CF)) { const v = CF[k].v, f = CF[k].dir > 0 ? v / A0[k] : A0[k] / v; FL[k] = { f, v, dir: CF[k].dir }; put('flip_' + fkey[k] + '_f', f, 5); put('flip_' + fkey[k] + '_v', v, 4); }
/* a fine scan of the independent ledger confirms every closed form: the ranking is unchanged just inside the value and reversed just outside it */
for (const k of Object.keys(CF)) {
  const f = FL[k].f, dir = FL[k].dir, at = (g) => { const a = Object.assign({}, A0); a[k] = dir > 0 ? A0[k] * g : A0[k] / g; return orderAt(a, 8, 64, 'sim0.01'); };
  check(at(f * 0.995) === REF && at(f * 1.005) !== REF, 'closed form for the reversal of ' + k + ' at x' + f.toFixed(3) + ': inside ' + at(f * 0.995) + ', outside ' + at(f * 1.005));
}
/* and no assumption of LG.assume that has no closed form reverses anything within a factor of 1000 (the footage discard is not in the price, the force and supervisor lines are not in the layouts column) */
{ const LIM = { duty: 1, discard: 0.99, video_duty: 1, force_duty: 1, sup_duty: 1 };
  for (const k of Object.keys(A0)) if (!(k in CF)) for (const dir of [-1, 1]) for (let i = 1; i <= 600; i++) { const g = Math.pow(10, 3 * i / 600), a = Object.assign({}, A0); a[k] = dir > 0 ? A0[k] * g : A0[k] / g; if (a[k] > (LIM[k] || Infinity)) break;
    if (orderAt(a, 8, 64, 'sim0.01') !== REF) { fail('assumption ' + k + ' reverses the ranking at x' + g.toFixed(2) + ' and has no closed form'); break; } } }
const sorted = Object.keys(FL).sort((x, y) => FL[x].f - FL[y].f);
check(sorted[0] === 'duty' && sorted[1] === 'wage_per_h' && sorted[2] === 'video_wage_per_h' && FL.curate_per_h.f > 3, 'the three assumptions nearest a reversal are the duty cycle, the operator wage and the footage wage (got ' + sorted.slice(0, 4).join(', ') + ')');
check(FL.duty.dir < 0 && FL.wage_per_h.dir > 0 && FL.video_wage_per_h.dir < 0, 'duty and footage wage must fall, operator wage must rise');
put('flip_sim_min', Math.min(FL.scene_weeks.f, FL.scene_uses_h.f, FL.gpu_per_h.f, FL.week_cost.f), 4);
{ const wdn = (cO * A0.duty * keep0 - arm0); put('flip_wage_down_f', A0.wage_per_h / wdn, 4); }
const BE = (A0.wage_per_h + arm0) / keep0 / cV; put('be_duty', BE, 5); put('be_duty_pct', BE * 100, 3);
near(BE, FL.duty.v, 1e-12, 'the nearest reversal in duty is the break-even duty');
check(BE > 10 / 60 && BE < 20 / 30, 'the break-even duty lies inside the range ALOHA\'s numbers give');
put('aloha_lo', 10 / 60 * 100, 3); put('aloha_hi', 20 / 30 * 100, 3); put('aloha_ratio', (20 / 30) / (10 / 60), 3);
/* the order, and the own price, at the duty cycles the prose names */
for (const d of [0.05, 0.06, 0.17, 0.2, 0.3, 0.67]) {
  const a = Object.assign({}, A0, { duty: d }), K = campaign(a), tg = String(Math.round(d * 100)).padStart(2, '0');
  put('own_duty' + tg, K.own.price, 4);
  const o = orderAt(a, 8, 64, 'sim0.01'), want = d < BE ? 'sim0.01 < twin < old < video < own' : 'sim0.01 < twin < old < own < video';
  check(o === want, 'at duty ' + d + ' the cost order is ' + want + ' (got ' + o + ')');
}
put('r07_sec', 9.3 + 20 + 120, 3); put('r07_duty', 9.3 / (9.3 + 20 + 120), 5); put('r07_duty_pct', 9.3 / 149.3 * 100, 3);
put('own_r07', campaign(Object.assign({}, A0, { duty: 9.3 / 149.3 })).own.price, 4); put('ratio_r07_video', F.own_r07 / C64.video, 3); put('ratio_r07_old', F.own_r07 / C64.old, 3);
check(F.own_r07 > C64.video && F.own_r07 > 10 * C64.old, 'at robot lesson 7\'s rebuild times the own hour is dearer than footage\'s useful hour and more than ten times the older arm\'s');
/* the other sliders of the widget */
{ const w80 = campaign(Object.assign({}, A0, { wage_per_h: 80 })); put('own_wage80', w80.own.price, 4); check(w80.own.price > cV, 'at an $80 wage the own hour passes footage');
  const d50 = campaign(Object.assign({}, A0, { discard: 0.5 })); put('own_disc50', d50.own.price, 4); check(d50.own.price > cV, 'at 50 % discards the own hour passes footage');
  const g25 = campaign(Object.assign({}, A0, { gpu_per_h: 25 })); put('p_sim_gpu25', g25.sim.price, 5); put('c_sim01_gpu25', g25.sim.price / rS, 4);
  const w16 = campaign(Object.assign({}, A0, { scene_weeks: 16 })); put('p_sim_w16', w16.sim.price, 5); put('c_sim01_w16', w16.sim.price / rS, 4);
  const both = campaign(Object.assign({}, A0, { gpu_per_h: 25, scene_weeks: 16 })); put('c_sim01_both', both.sim.price / rS, 4); put('ratio_twin_sim_both', cT / F.c_sim01_both, 3);
  check(orderAt(Object.assign({}, A0, { gpu_per_h: 25, scene_weeks: 16 }), 8, 64, 'sim0.01') === REF, 'ten times the GPU price and four times the authoring leave the ranking where it was'); }

/* ───────────────────────── 5. the columns no cheap hour carries (contact and recovery), recomputed live ───────────────────────── */
const MC = [1, 2, 3, 5, 10, 20, 40], W1 = INS.world(1.0), cf = { w: [], n: [] };
MC.forEach((m) => { const rolls = INS.demos(W1, m, 23); [[true, cf.w], [false, cf.n]].forEach(([wf, o]) => { const fr = INS.frames(rolls, wf), cl = INS.clone(fr, wf); o.push(INS.evaluate(W1, () => cl, 200, 5).succ); }); });
const secAttempt = INS.evaluate(W1, () => INS.yielding(), 200, 5).attempt;
cf.w.forEach((v, i) => near(v, LG.TABLE.contact.withForce.s[i], 6e-5, 'contact with force ' + MC[i])); cf.n.forEach((v, i) => near(v, LG.TABLE.contact.noForce.s[i], 6e-5, 'contact without force ' + MC[i]));
put('force_cap_no', Math.max(...cf.n), 4); put('force_lo_no', Math.min(...cf.n), 4); put('force_at40_no', cf.n[6], 4); put('force_1', cf.w[0], 4); put('force_5', cf.w[3], 4); put('force_10', cf.w[4], 4); put('force_40', cf.w[6], 4);
put('sec_attempt', secAttempt, 3);
check(Math.max(...cf.n) < 0.7 && cf.w[0] > 0.8 && cf.w[4] > 0.95, 'without force at most 0.67 at any number of demonstrations; with force 0.825 from one and 0.985 from ten');
check(Math.max(...cf.n) < Math.min(...cf.w), 'the best force-less result is below the worst force-bearing result');
put('force10_s', 10 * secAttempt, 2); put('noforce40_s', 40 * secAttempt, 2);
put('cost_force10', 10 * secAttempt / 3600 * K0.force.price, 4); put('cost_noforce40', 40 * secAttempt / 3600 * K0.force0.price, 4); put('ratio_contact', F.cost_noforce40 / F.cost_force10, 3);
check(F.cost_noforce40 > F.cost_force10, 'forty force-less insertions cost more than ten force-bearing ones');
/* recovery: calm demonstrations, and 20 calm demonstrations plus rounds of corrections */
const NREC = [1, 2, 3, 5, 10, 20, 40, 80];
function calmCurve() {
  const wA = DL.WA, rng = BN.rng(1), nw = new BN.NW(DL.H), s = []; let done = 0;
  NREC.forEach((n) => { while (done < n) { const ro = BN.rollout(wA, BN.expertPolicy(wA), rng, { noise: 0, jit: DL.JIT }); for (let t = 0; t < ro.A.length; t++) nw.add(ro.S[t], ro.A[t]); done++; }
    s.push(BN.evaluate(wA, () => (q) => DL.predict(nw, q), DL.NEVAL, DL.SEED, { noise: DL.GUST, jit: DL.JIT }).succ); });
  return s;
}
const calm = calmCurve(); calm.forEach((v, i) => near(v, LG.TABLE.recover.calm.s[i], 6e-5, 'calm demonstrations ' + NREC[i]));
const ses = DL.session('prog', 0, 'latest', DL.DEFAULT_SEED), corr = []; for (let r = 0; r <= 3; r++) corr.push(DL.evaluate(ses, r));
corr.forEach((e, r) => near(e.succ, LG.TABLE.recover.corr.s[r], 6e-5, 'corrections round ' + r));
put('calm_cap', Math.max(...calm), 4); put('calm_10', calm[4], 4); put('calm_80', calm[7], 4); put('calm_lo', Math.min(...calm.slice(4)), 4); put('corr_3', corr[3].succ, 4); put('corr_labelled', corr[3].labelled, 0);
check(Math.max(...calm) < 0.7 && corr[3].succ > 0.95, 'calm demonstrations stay below 0.7 at any number; three rounds of corrections reach 0.96');
check(calm.slice(4).every((v) => v < 0.7), 'from 10 to 80 calm demonstrations the success never reaches 0.7');
put('cost_calm80', 80 * 9.3 / 3600 * K0.own.price, 4);
put('cost_corr3', 20 * 9.3 / 3600 * K0.own.price + corr[3].labelled * DT / 3600 * K0.corr.price, 4); put('corr_hours', corr[3].labelled * DT / 3600, 4); put('ratio_recovery', F.cost_calm80 / F.cost_corr3, 3);
put('corr_runs', corr[3].rollouts, 0); put('calm_demos_corr', 20, 0);
check(F.cost_calm80 > F.cost_corr3, 'eighty calm demonstrations cost more than twenty calm demonstrations and three rounds of corrections');

/* ───────────────────────── 6. twelve other draws of layouts: the claims must not hang on the table's draw ───────────────────────── */
const DR = { video: [], old: [], twin: [], s01: [], s015: [], s02: [], s03: [], cv: [], co: [], blocks: [] };
for (let d = 0; d < 12; d++) {
  const D = drawOf(1000 + d, 3000 + d), r = (k) => D.cell(k, 8, 64).rho;
  DR.video.push(r('video')); DR.old.push(r('old')); DR.twin.push(r('twin')); DR.s01.push(r('sim0.01')); DR.s015.push(r('sim0.015')); DR.s02.push(r('sim0.02')); DR.s03.push(r('sim0.03'));
  DR.cv.push(cost(P.video, r('video'))); DR.co.push(cost(P.old, r('old')));
  const s = (m) => (m === 0 ? D.cur.hand[GRID.indexOf(8)] : D.cell('twin', 8, m).s), per = (m0, m1) => ((m1 - m0) * 9.3 / 3600 * P.twin) / ((s(m1) - s(m0)) * 100);
  DR.blocks.push(per(64, 256) / per(0, 16));
}
const mn = (v) => Math.min(...v), mx = (v) => Math.max(...v);
put('dr_n', DR.video.length, 0);
put('dr_video_lo', mn(DR.video), 4); put('dr_video_hi', mx(DR.video), 4); put('dr_old_lo', mn(DR.old), 4); put('dr_old_hi', mx(DR.old), 4); put('dr_twin_lo', mn(DR.twin), 4); put('dr_twin_hi', mx(DR.twin), 4);
put('dr_s01_lo', mn(DR.s01), 4); put('dr_s01_hi', mx(DR.s01), 4); put('dr_s015_lo', mn(DR.s015), 4); put('dr_s015_hi', mx(DR.s015), 4); put('dr_s02_lo', mn(DR.s02), 4); put('dr_s02_hi', mx(DR.s02), 4); put('dr_s03_hi', mx(DR.s03), 4);
put('dr_cv_lo', mn(DR.cv), 3); put('dr_cv_hi', mx(DR.cv), 3); put('dr_co_lo', mn(DR.co), 3); put('dr_co_hi', mx(DR.co), 3);
put('dr_blocks_lo', mn(DR.blocks), 3); put('dr_blocks_hi', mx(DR.blocks), 3);
check(DR.cv.every((c) => c > P.own), 'on every one of twelve other draws a useful hour of footage costs more than the own hour');
check(DR.co.every((c) => c < P.own), 'on every one of twelve other draws a useful hour of the older arm costs less than the own hour');
check(DR.s03.every((x) => x < 0), 'the 3 % simulator with joint labels has a negative rate on every draw');
check(DR.s015.every((x) => x > 0) && DR.s02.every((x) => x < 0), 'the simulator\'s rate is positive at a gap of 1.5 % and negative at 2 % on every draw');
check(DR.s01.every((x) => x > F.sim_rate_floor), 'the 1 % simulator is above the rate at which the twin would overtake it on every draw');
check(DR.blocks.every((x) => x > 5), 'the last block of twin layouts costs more than five times as much per point as the first on every draw');
put('rho_s015', T0.cell('sim0.015', 8, 64).rho, 4); put('rho_s02', T0.cell('sim0.02', 8, 64).rho, 4);
check(T0.cell('sim0.015', 8, 64).rho > 0 && T0.cell('sim0.02', 8, 64).rho < 0, 'on the table\'s draw the rate crosses zero between a gap of 1.5 % and 2 %');

/* ───────────────────────── 7. the exit: a cost per useful hour is the cost of the first hour ───────────────────────── */
const sAt = (k, m) => (m === 0 ? TL.src[k].s[8][0] : TL.src[k].s[8][MI(m)]);
const usdBlock = (k, m0, m1) => (m1 - m0) * 9.3 / 3600 * pOf(k), ptsBlock = (k, m0, m1) => (sAt(k, m1) - sAt(k, m0)) * 100;
for (const k of ['twin', 'old']) [[0, 16], [16, 64], [64, 256]].forEach(([m0, m1], i) => {
  put(`blk_${k}_pts${i + 1}`, ptsBlock(k, m0, m1), 4); put(`blk_${k}_usd${i + 1}`, usdBlock(k, m0, m1), 4); put(`blk_${k}_per${i + 1}`, usdBlock(k, m0, m1) / ptsBlock(k, m0, m1), 5);
});
put('blk_twin_ratio', F.blk_twin_per3 / F.blk_twin_per1, 3); put('blk_old_ratio', F.blk_old_per3 / F.blk_old_per1, 3);
check(F.blk_twin_per1 < F.blk_twin_per2 && F.blk_twin_per2 < F.blk_twin_per3 && F.blk_old_per1 < F.blk_old_per2 && F.blk_old_per2 < F.blk_old_per3, 'dollars per point of success rise block by block for the twin and the older arm');
put('twin_rate_min', Math.min(...[16, 64, 256].map((m) => RHO('twin', 8, m))), 4); put('twin_rate_max', Math.max(...[16, 64, 256].map((m) => RHO('twin', 8, m))), 4);
check(RHO('old', 8, 16) > RHO('old', 8, 64) && RHO('old', 8, 64) > RHO('old', 8, 256), 'the older arm\'s rate falls with the hours bought');
put('c_old_ratio_256_16', cost(P.old, RHO('old', 8, 256)) / cost(P.old, RHO('old', 8, 16)), 3);
/* the demonstration lengths behind 'an hour is 387.1 demonstrations' */
{ const att = (body, th) => { let s = 0; for (let i = 0; i < 64; i++) s += record(body, th[i], 500 + i).n; return s / 64 * DT; };
  put('attempt_s_own', att(BODY.A, layouts(NFILE, 1011)), 3); put('attempt_s_old', att(BODY.old, T0.fT), 3); put('attempt_s_video', att(BODY.video, T0.fT), 3); }
/* the prose says that counting every attempt as 9.3 s moves a cost by a tenth and no ranking: rescale the two sources to their true attempted hours (a cost per useful hour scales with the attempt length) */
{ const so = F.attempt_s_old / 9.3, sv = F.attempt_s_video / 9.3;
  check(Math.abs(so - 1) < 0.11 && Math.abs(so - 1) > 0.09 && Math.abs(sv - 1) < 0.05, 'attempt lengths move a cost by about a tenth (older arm x' + so.toFixed(3) + ', footage x' + sv.toFixed(3) + ')');
  const rows = R5.map((r) => ({ k: r.k, c: r.c * (r.k === 'old' ? so : r.k === 'video' ? sv : 1) })), ord = rows.slice().sort((x, y) => x.c - y.c).map((r) => r.k).join(' < ');
  check(ord === 'sim0.01 < twin < old < own < video', 'true attempt lengths leave the cost ranking unchanged: ' + ord); }
/* a cell twice as dear moves the own price by about a tenth (the arm is 10 % of a wall-clock hour) */
check(Math.abs(campaign(Object.assign({}, A0, { arm_cost: 2 * A0.arm_cost })).own.price / K0.own.price - 1 - 0.10) < 0.005, 'a cell twice as dear moves the own hour by a tenth');

/* ───────────────────────── 8. arithmetic on the verified numbers the lesson cites ───────────────────────── */
put('umi_per_h', 1400 / 12, 3); put('umi_duty', 1400 / 12 * 9.3 / 3600 * 100, 3); put('umi_ratio', 111 / 35, 3);
put('rt1_per_day', 130000 / (13 * 17 * 30.4), 3); put('droid_h_per_collector', 350 / 50, 3); put('droid_unsucc', 16 / (76 + 16) * 100, 3); put('rh20t_fail', 1 / 11 * 100, 3); put('droid_ratio', 8.7 / 1.7, 3);
put('maloha_h', (50 * 26 + 20 * 75 + 50 * 22 + 50 * 30 + 50 * 45 + 50 * 40 + 20 * 40) / 3600, 3);
put('droid_s_per_demo', 350 * 3600 / 76000, 3); put('curate_minutes', A.curate_per_h / A.wage_per_h * 60, 3);

/* ───────────────────────── 9. the checkpoint exercise ───────────────────────── */
{ const w = 50, arm = 5, d = 0.5, x = 0.2, pSrc = 20, rho = 0.25;
  const pown = (w + arm) / (d * (1 - x)); put('ck_own', pown, 4); put('ck_cost', pSrc / rho, 4); put('ck_be', pSrc / pown, 4); put('ck_twice', pSrc / (1 - x) / rho, 4); put('ck_duty', (w + arm) / (1 - x) / (pSrc / rho), 4);
  check(pSrc / rho < pown, 'the checkpoint source is worth buying'); check(pSrc / (1 - x) / rho < pown, 'and still is when its discard is charged twice'); }

/* ───────────────────────── 10. the engine of the page agrees with the independent ledger ───────────────────────── */
const PL = require(path.join(root, dir, 'price_lab.js'));
{ const L = PL.ledger(A0, 8, 64, 'sim0.01'), want = rowsAt(A0, 8, 64, 'sim0.01');
  L.rows.forEach((r, i) => { near(r.p, want[i].p, 1e-9, 'engine price of ' + r.name); near(r.rho, want[i].rho, 1e-9, 'engine rate of ' + r.name); near(r.c, want[i].c, 1e-7, 'engine cost of ' + r.name); });
  near(PL.breakEvenDuty(A0, 8, 64), BE, 1e-9, 'engine break-even duty');
  const fl = PL.flips(A0, 8, 64, 'sim0.01'), byKey = {}; fl.forEach((f) => { if (!byKey[f.key] || f.factor < byKey[f.key].factor) byKey[f.key] = f; });
  for (const k of Object.keys(CF)) { check(!!byKey[k], 'engine finds a reversal for ' + k); if (byKey[k]) near(byKey[k].factor / FL[k].f, 1, 1e-6, 'engine reversal factor of ' + k + ' (' + byKey[k].factor + ' vs ' + FL[k].f + ')'); }
  check(fl[0].key === 'duty', 'the engine puts the duty cycle first');
  const pc = PL.columns(A0); near(pc[0].rows[0].p, K0.force0.price, 1e-9, 'engine force-less price'); near(pc[0].rows[1].p, K0.force.price, 1e-9, 'engine force price'); near(pc[1].rows[1].p, K0.corr.price, 1e-9, 'engine corrections price'); }

/* ───────────────────────── 11. the widget prints the same numbers ───────────────────────── */
const html = path.join(root, dir, '02_prices_and_the_ledger.html');
if (fs.existsSync(html)) {
  const pg = loadPage(html);
  pg.problems.forEach((p) => fail('page problem: ' + p));
  const eq = (id, want, digits, what) => { const got = pg.num(id); if (!(Math.abs(got - want) <= 0.5 * Math.pow(10, -digits) + 1e-9)) fail(`${what}: widget #${id} prints ${got}, independent computation gives ${want}`); };
  const has = (id, s, what) => { if (!pg.text(id).includes(s)) fail(`${what}: widget #${id} prints '${pg.text(id)}', expected it to contain '${s}'`); };
  const dig = (v) => (v < 1 ? 2 : v < 1000 ? 1 : 0);
  const state = (o) => { const s = Object.assign({ duty: 0.4, wage: 40, disc: 0.1, gpu: 2.5, weeks: 4, sim: 'sim0.01', op: '8,64' }, o);
    pg.set('w02-duty', s.duty); pg.set('w02-wage', s.wage); pg.set('w02-disc', s.disc); pg.set('w02-gpu', s.gpu); pg.set('w02-weeks', s.weeks); pg.set('w02-sim', s.sim); pg.set('w02-op', s.op); pg.drain(); return s; };
  const probe = (o, tagText) => {
    const s = state(o), a = Object.assign({}, A0, { duty: s.duty, wage_per_h: s.wage, discard: s.disc, gpu_per_h: s.gpu, scene_weeks: s.weeks }), [base, m] = s.op.split(',').map(Number), K = campaign(a);
    const rhoS = RHO(s.sim, base, m), pw = { own: K.own.price, twin: K.cur.price, old: K.cur.price, video: K.vid.price, sim: K.sim.price };
    const cOwn = pw.own, cTwin = cost(pw.twin, RHO('twin', base, m)), cOld = cost(pw.old, RHO('old', base, m)), cVid = cost(pw.video, RHO('video', base, m)), cSim = cost(pw.sim, rhoS);
    eq('w02-pown', cOwn, dig(cOwn), tagText + ' own hour'); eq('w02-pvid', pw.video, 2, tagText + ' footage price'); eq('w02-cvid', cVid, dig(cVid), tagText + ' footage cost');
    { const lo = cost(pw.video, T0.cell('video', base, m).rhi4); eq('w02-civid', lo, dig(lo), tagText + ' footage interval low'); }
    eq('w02-cold', cOld, dig(cOld), tagText + ' older arm'); eq('w02-ctwin', cTwin, dig(cTwin), tagText + ' twin');
    if (isFinite(cSim)) eq('w02-csim', cSim, dig(cSim), tagText + ' simulator'); else has('w02-csim', 'none', tagText + ' simulator');
    const rows = [['own robot', cOwn], ['twin arm', cTwin], ['older arm', cOld], ['footage', cVid], ['simulator', cSim]].filter((r) => isFinite(r[1])).sort((x, y) => x[1] - y[1]);
    const dear = rows[rows.length - 1], cheap = rows[0];
    eq('w02-dear', dear[1], dig(dear[1]), tagText + ' dearest'); has('w02-dear', dear[0], tagText + ' dearest name'); eq('w02-cheap', cheap[1], dig(cheap[1]), tagText + ' cheapest'); has('w02-cheap', cheap[0], tagText + ' cheapest name');
    eq('w02-bed', (a.wage_per_h + a.arm_cost / a.arm_life_h) / (1 - a.discard) / cVid, 2, tagText + ' break-even duty');
    const dbl = (a.video_wage_per_h + a.track_per_h) / (a.video_duty * (1 - a.video_discard)) / RHO('video', base, m); eq('w02-cdbl', dbl, dig(dbl), tagText + ' double-counted footage');
  };
  probe({}, 'default');
  eq('w02-pown', F.p_own, 1, 'default own hour = fact'); eq('w02-cvid', F.c_video, 1, 'default footage = fact'); eq('w02-cdbl', F.c_video_double, 1, 'default double count = fact'); eq('w02-csim', F.c_s001, 2, 'default simulator = fact'); eq('w02-civid', F.c_video_ci_lo, 1, 'default footage interval = fact');
  eq('w02-cold', F.c_old, 1, 'default older arm = fact'); eq('w02-ctwin', F.c_twin, 1, 'default twin = fact'); eq('w02-bed', F.be_duty, 2, 'default break-even duty = fact');
  has('w02-flip', 'duty', 'default nearest reversal'); eq('w02-flip', FL.duty.f, 2, 'default nearest reversal factor');
  probe({ duty: 0.17 }, 'duty 0.17'); has('w02-dear', 'own robot', 'duty 0.17: the own hour is the dearest'); eq('w02-pown', F.own_duty17, 1, 'duty 0.17 = fact');
  probe({ duty: 0.2 }, 'duty 0.20'); has('w02-dear', 'own robot', 'duty 0.20'); probe({ duty: 0.3 }, 'duty 0.30'); has('w02-dear', 'footage', 'duty 0.30');
  probe({ duty: 0.67 }, 'duty 0.67'); eq('w02-pown', F.own_duty67, 1, 'duty 0.67 = fact'); has('w02-dear', 'footage', 'duty 0.67');
  probe({ duty: 0.06 }, 'duty 0.06'); has('w02-dear', 'own robot', 'duty 0.06'); eq('w02-pown', F.own_duty06, 1, 'duty 0.06 = fact');
  probe({ sim: 'sim0.03' }, 'sim 3 % joint'); has('w02-csim', 'none', 'the 3 % simulator with joint labels sells no useful hour');
  probe({ sim: 'simH0.03' }, 'sim 3 % hand'); eq('w02-csim', F.c_sH003, 2, 'sim 3 % hand = fact'); has('w02-cheap', 'simulator', 'cheapest with hand labels');
  probe({ sim: 'sim0.001' }, 'sim 0.1 %'); eq('w02-csim', F.c_s0001, 2, 'sim 0.1 % = fact'); probe({ sim: 'sim0.003' }, 'sim 0.3 %'); eq('w02-csim', F.c_s0003, 2, 'sim 0.3 % = fact');
  probe({ gpu: 25 }, 'gpu 25'); eq('w02-csim', F.c_sim01_gpu25, dig(F.c_sim01_gpu25), 'gpu 25 = fact');
  probe({ weeks: 16 }, 'weeks 16'); eq('w02-csim', F.c_sim01_w16, dig(F.c_sim01_w16), 'weeks 16 = fact');
  probe({ gpu: 25, weeks: 16 }, 'both'); eq('w02-csim', F.c_sim01_both, dig(F.c_sim01_both), 'gpu 25 and weeks 16 = fact');
  probe({ wage: 80 }, 'wage 80'); eq('w02-pown', F.own_wage80, 1, 'wage 80 = fact'); has('w02-dear', 'own robot', 'wage 80');
  probe({ disc: 0.5 }, 'discard 0.5'); eq('w02-pown', F.own_disc50, 1, 'discard 0.5 = fact'); has('w02-dear', 'own robot', 'discard 0.5');
  probe({ op: '8,16' }, 'op 8/16'); eq('w02-cold', F.c_old_8_16, 1, '8/16 older arm = fact'); eq('w02-ctwin', F.c_twin_8_16, 1, '8/16 twin = fact'); eq('w02-cvid', F.c_video_8_16, 1, '8/16 footage = fact');
  probe({ op: '8,256' }, 'op 8/256'); eq('w02-cold', F.c_old_8_256, 1, '8/256 older arm = fact'); eq('w02-ctwin', F.c_twin_8_256, 1, '8/256 twin = fact'); eq('w02-cvid', F.c_video_8_256, 0, '8/256 footage = fact');
  probe({ op: '32,64' }, 'op 32/64'); eq('w02-cold', F.c_old_32_64, 1, '32/64 older arm = fact'); eq('w02-cvid', F.c_video_32_64, 0, '32/64 footage = fact'); has('w02-dear', 'footage', '32/64 dearest');
  probe({ op: '32,16' }, 'op 32/16'); probe({ op: '32,256' }, 'op 32/256');
  probe({ duty: 0.17, op: '8,256' }, 'duty 0.17 at 8/256'); has('w02-dear', 'footage', 'at 256 attempted layouts footage is the dearest even at duty 0.17');
  state({});
}

/* ───────────────────────── 12. print ───────────────────────── */
if (bad) console.error(bad + ' check(s) failed');
console.log(JSON.stringify({ facts: F }));
process.exit(bad ? 1 : 0);
