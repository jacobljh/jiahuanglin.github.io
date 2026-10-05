#!/usr/bin/env node
'use strict';
/* Oracle for embodied_training_data lesson 03 (the thousandth hour: diminishing returns).
 * Re-derives every number the lesson quotes with code written separately from returns_lab.js and bodies_lab.js: its own recorder of demonstrations (an explicit plant), its own
 * follower (per-chunk lookups, plain arrays), its own pool scorer (a full scan of every stored layout, from a matrix of distances), its own own-layout curves and exchange rates,
 * its own regressions, its own exhaustive search over the splits of a budget and its own versions of the shortcuts.  Only the world's primitives (arm, expert, posts, collision)
 * come from bench.js, and the prices (assumptions) from ledger.js, whose arithmetic is repeated here as a check.  Every table cell the lesson quotes is recomputed and compared with
 * the stored table.  Then it drives the page's widget through the states the prose describes and compares what it prints with the independent computation.
 * Last stdout line: {"facts": {...}}. */
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '../../../all_lessons');
const dir = fs.existsSync(path.join(root, 'embodied_training_data_new')) ? 'embodied_training_data_new' : 'embodied_training_data';
const BN = require(path.join(root, dir, 'bench.js'));
const LG = require(path.join(root, dir, 'ledger.js'));
const { loadPage } = require('../dom_probe.js');

let bad = 0;
const fail = (m) => { bad++; console.error('FAIL ' + m); };
const check = (c, m) => { if (!c) fail(m); };
const F = {};
const put = (k, v, d) => { F[k] = +(+v).toFixed(d === undefined ? 4 : d); };

/* ───── the world, written out independently ───── */
const DT = 0.05, JIT = 0.01, GUST = 0.08, CH = 16, KST = 20, NT = 1000, NFILE = 256, EVSEED = 5;
const BODY = {
  A: { L1: 0.5, L2: 0.5, gain: 0.85 }, twin: { L1: 0.5, L2: 0.5 },
  old: { L1: 0.5, L2: 0.5, rgain: 0.85, lag: 0.1, noise: 0.12 },
  video: { L1: 0.5, L2: 0.5, rgain: 0.85, lag: 0, noise: 0.12, labelNoise: 0.003 },
};
for (const g of [0.001, 0.003, 0.01, 0.03]) BODY['sim' + g] = { L1: 0.5 * (1 + g), L2: 0.5 * (1 - g) };
const clip = (x) => Math.max(-1.5, Math.min(1.5, x));
function layouts(n, seed) { const r = BN.rng(seed), out = []; for (let i = 0; i < n; i++) { const s = (2 * r() - 1) * 0.10, t = (2 * r() - 1) * 0.20; out.push([s, t]); } return out; }
const worldOf = (th, b) => BN.slalom.world(5, { shift: th[0], tilt: th[1], body: { L1: b.L1, L2: b.L2 } });
const postY = new Map();                                   // the heights of the five posts of a layout, read off the world itself
function ys(th) { let v = postY.get(th); if (!v) { v = worldOf(th, BODY.A).posts.map((p) => p[1]); postY.set(th, v); } return v; }
function dist(a, b) { const ya = ys(a), yb = ys(b); let m = 0; for (let i = 0; i < 5; i++) m = Math.max(m, Math.abs(ya[i] - yb[i])); return m; }
/* a demonstration, with the plant written out: realised velocity = gain x clipped command (first-order lag if any), plus gust, every step; footage adds tracker noise to the hand */
function record(body, th, seed) {
  const w = worldOf(th, body), rng = BN.rng(seed), T = 2 * BN.slalom.horizon(w), g = body.rgain || 1, lag = body.lag || 0, nz = body.noise || 0, xe = BN.slalom.xEnd(w);
  const q = BN.slalom.startQ(w, JIT * BN.randn(rng)).slice(), v = [0, 0], Q = [], P = [];
  let coll = false, done = false;
  for (let t = 0; t < T; t++) {
    const p = BN.arm.fk(q, w.body); Q.push([q[0], q[1]]); P.push(p.slice());
    if (BN.slalom.collide(w, p)) { coll = true; break; }
    if (p[0] > xe - 0.02) { done = true; break; }
    const u = BN.slalom.expertAct(w, q);
    for (let k = 0; k < 2; k++) { const c = clip(u[k]) * g; v[k] = lag > 0 ? v[k] + (DT / (lag + DT)) * (c - v[k]) : c; q[k] += DT * (v[k] + (nz ? nz * BN.randn(rng) : 0)); }
  }
  if (body.labelNoise) { const r = BN.rng(seed * 7 + 3); for (let i = 0; i < P.length; i++) { P[i][0] += body.labelNoise * BN.randn(r); P[i][1] += body.labelNoise * BN.randn(r); } }
  return { th, Q, P, n: Q.length, ok: done && !coll };
}
function fileOf(bodyKey, thetas, uid) { const out = []; for (let k = 0; k < thetas.length; k++) { const d = record(BODY[bodyKey], thetas[k], 500 + k); if (d.ok) { d.k = k; d.uid = uid + '#' + k; out.push(d); } } return out; }
/* one run of arm A on test layout k, following a stored demonstration: 1 completed, 2 touched a post, 3 timed out */
function follow(th, dm, space, seed) {
  const me = BODY.A, w = worldOf(th, me), rng = BN.rng(seed), T = BN.slalom.horizon(w), xr = BN.slalom.xEnd(w) - 0.02;
  const q = BN.slalom.startQ(w, JIT * BN.randn(rng)).slice();
  let i0 = 0;
  for (let t = 0; t < T; t++) {
    const p = BN.arm.fk(q, w.body);
    if (BN.slalom.collide(w, p)) return 2;
    if (p[0] > xr) return 1;
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
  return 3;
}
const tests = layouts(NT, 99), ownTh = layouts(NFILE, 1011), forTh = layouts(NFILE, 2024);
const memo = new Map();
function outcome(dm, space, k) { const key = dm.uid + '|' + space + '|' + k; let r = memo.get(key); if (r === undefined) { r = follow(tests[k], dm, space, 1000 * EVSEED + k + 1); memo.set(key, r); } return r; }
/* success of a pool given as parts [{demos, count, space, role}] in tie-break order: the nearest stored layout of any part, the first of equals */
function pool(parts) {
  let ok = 0; const pick = {}, good = {};
  for (let k = 0; k < NT; k++) {
    let best = null, bd = Infinity, bj = 0;
    for (const p of parts) for (let j = 0; j < p.count; j++) { const d = p.D[k * p.nd + j]; if (d < bd) { bd = d; best = p; bj = j; } }
    const r = outcome(best.demos[bj], best.space, k);
    pick[best.role] = (pick[best.role] || 0) + 1; if (r === 1) { ok++; good[best.role] = (good[best.role] || 0) + 1; }
  }
  return { succ: ok / NT, ok, pick, good };
}
/* a source's layouts as a matrix of distances from every test layout to every kept demonstration (the nearest is found by scanning it) */
const LISTS = new Map();
function getList(role, bodyKey, draw) {
  const key = role + '|' + bodyKey + '|' + draw; if (LISTS.has(key)) return LISTS.get(key);
  const th = role === 'own' ? ownTh : layouts(NFILE, (role === 'twin' ? 2125 : 2428) + 1000 * draw);
  const demos = fileOf(role === 'own' ? 'A' : bodyKey, th, key), nd = demos.length, D = new Float64Array(NT * nd);
  for (let k = 0; k < NT; k++) for (let j = 0; j < nd; j++) D[k * nd + j] = dist(tests[k], demos[j].th);
  const L = { demos, nd, D, kept: (n) => { let c = 0; while (c < nd && demos[c].k < n) c++; return c; } };
  LISTS.set(key, L); return L;
}
const OTHER = {
  'sim0.003': { body: 'sim0.003', space: 'joint', price: 'sim', tab: 'sim0.003' }, 'sim0.01': { body: 'sim0.01', space: 'joint', price: 'sim', tab: 'sim0.01' },
  'sim0.03': { body: 'sim0.03', space: 'joint', price: 'sim', tab: 'sim0.03' }, 'simH0.03': { body: 'sim0.03', space: 'hand', price: 'sim', tab: 'simH0.03' },
  old: { body: 'old', space: 'hand', price: 'old', tab: 'old' }, video: { body: 'video', space: 'hand', price: 'video', tab: 'video' },
};
/* the pool of na own layouts, n attempted twin layouts and m attempted layouts of another source, on one draw of the layouts */
const SC = new Map();
function poolOf(draw, other, na, n, m) {
  const key = [draw, other, na, n, m].join('|'); if (SC.has(key)) return SC.get(key);
  const A = getList('own', 'A', draw), T = getList('twin', 'twin', draw), O = getList('other', OTHER[other].body, draw);
  const r = pool([{ demos: A.demos, D: A.D, nd: A.nd, count: na, space: 'hand', role: 'own' }, { demos: T.demos, D: T.D, nd: T.nd, count: T.kept(n), space: 'hand', role: 'twin' },
    { demos: O.demos, D: O.D, nd: O.nd, count: m > 0 ? O.kept(m) : 0, space: OTHER[other].space, role: 'other' }]);
  SC.set(key, r); return r;
}

/* ───── the ledger's own-layout curves and exchange rates, recomputed (draw: the table's lists, one list for every foreign source) ───── */
const GRID = [1, 2, 4, 8, 12, 16, 24, 32, 48, 64, 96, 128, 192, 256], MS = [0, 4, 8, 16, 32, 64, 128, 256], NA = 8;
const ownFile = fileOf('A', ownTh, 'tab:own');
function lst(demos) { const nd = demos.length, D = new Float64Array(NT * nd); for (let k = 0; k < NT; k++) for (let j = 0; j < nd; j++) D[k * nd + j] = dist(tests[k], demos[j].th); return { demos, nd, D }; }
const ownL = lst(ownFile);
const curve = (space) => GRID.map((n) => pool([{ demos: ownL.demos, D: ownL.D, nd: ownL.nd, count: n, space, role: 'own' }]).succ);
const cur = { hand: curve('hand'), joint: curve('joint') };
function equiv(Ns, S, s) {
  const env = []; let mx = 0; for (const x of S) { mx = Math.max(mx, x); env.push(mx); }
  let pn = 0, ps = 0;
  for (let i = 0; i < Ns.length; i++) { if (s <= env[i]) return pn + (Ns[i] - pn) * (s - ps) / Math.max(1e-12, env[i] - ps); pn = Ns[i]; ps = env[i]; }
  const a = Ns.length - 1, sl = (Ns[a] - Ns[a - 1]) / Math.max(1e-12, env[a] - env[a - 1]);
  return Ns[a] + sl * (s - env[a]);
}
const TAB = {};                                            // key -> {s: success at MS, rho: rate at MS, kept}
const SRCS = { twin: ['twin', 'hand'], old: ['old', 'hand'], video: ['video', 'hand'], 'sim0.003': ['sim0.003', 'joint'], 'sim0.01': ['sim0.01', 'joint'], 'sim0.001': ['sim0.001', 'joint'], 'simH0.03': ['sim0.03', 'hand'], 'sim0.03': ['sim0.03', 'joint'] };
for (const key of Object.keys(SRCS)) {
  const [body, space] = SRCS[key], f = fileOf(body, forTh, 'tab:' + key), fl = lst(f), s = [], rho = [], kept = [];
  for (const m of MS) {
    let c = 0; while (c < fl.nd && f[c].k < m) c++;
    const r = pool([{ demos: ownL.demos, D: ownL.D, nd: ownL.nd, count: NA, space, role: 'own' }, { demos: f, D: fl.D, nd: fl.nd, count: c, space, role: 'f' }]);
    s.push(r.succ); kept.push(c); rho.push(m > 0 ? (equiv(GRID, cur[space], r.succ) - NA) / m : null);
  }
  TAB[key] = { s, rho, kept };
}
{ // the stored table is what an independent run gives
  let mo = 0; GRID.forEach((n, i) => { mo = Math.max(mo, Math.abs(cur.hand[i] - LG.TABLE.layouts.ownHand.s[i]), Math.abs(cur.joint[i] - LG.TABLE.layouts.ownJoint.s[i])); });
  check(mo < 6e-5, 'own curves equal the stored table (max diff ' + mo + ')');
  for (const key of Object.keys(SRCS)) MS.forEach((m, i) => {
    check(Math.abs(TAB[key].s[i] - LG.TABLE.layouts.src[key].s[8][i]) < 6e-5, 'table cell ' + key + ' ' + m + ' success');
    if (m > 0) check(Math.abs(TAB[key].rho[i] - LG.TABLE.layouts.src[key].rho[8][i]) < 1.5e-4, 'table cell ' + key + ' ' + m + ' rate (' + TAB[key].rho[i] + ' vs ' + LG.TABLE.layouts.src[key].rho[8][i] + ')');
  });
}
/* prices: the ledger's arithmetic, repeated */
const A_ = LG.assume, armHour = A_.arm_cost / A_.arm_life_h, ownH = (A_.wage_per_h + armHour) / (A_.duty * (1 - A_.discard));
/* every borrowed source is priced per ATTEMPTED hour (its rate is measured per attempted hour and already holds its discards, which are paid once); the ledger's price for footage charges the discard as well */
const priceH = { own: ownH, twin: A_.curate_per_h, old: A_.curate_per_h, video: (A_.video_wage_per_h + A_.track_per_h) / A_.video_duty,
  sim: A_.gpu_per_h / A_.sim_speed + A_.scene_weeks * A_.week_cost / A_.scene_uses_h + A_.calib_h * ownH / A_.scene_uses_h };
for (const k of Object.keys(priceH)) if (k !== 'video') check(Math.abs(priceH[k] - LG.price(k)) < 1e-9, 'price ' + k);
check(Math.abs(priceH.video / (1 - A_.video_discard) - LG.price('video')) < 1e-9, 'the ledger\'s footage price is the per-attempted-hour price charged for its discard once more');
const HL = 9.3 / 3600, perLayout = (k) => priceH[k] * HL;
put('p_own_h', priceH.own, 2); put('p_twin_h', priceH.twin, 2); put('p_video_h', priceH.video, 2); put('p_sim_h', priceH.sim, 2); put('p_own_layout', perLayout('own'), 3); put('p_twin_layout', perLayout('twin'), 4); put('p_sim_layout', perLayout('sim'), 5);

/* ───── 1. the first hour and the 256th ───── */
const pc = (x) => 100 * x;
{ const s = TAB.twin.s; put('tw_s0', pc(s[0]), 1); put('tw_s4', pc(s[1]), 1); put('tw_s64', pc(s[5]), 1); put('tw_s128', pc(s[6]), 1); put('tw_s256', pc(s[7]), 1);
  const blk = (i, j, name) => { const gain = pc(s[j] - s[i]), hrs = (MS[j] - MS[i]) * HL, cost = hrs * priceH.twin; put(name + '_gain', gain, 1); put(name + '_cost', cost, 3); put(name + '_ppd', gain / cost, 1); put(name + '_pph', gain / hrs, 1); return gain / cost; };
  const a = blk(0, 1, 'b1'), b = blk(5, 6, 'b2'), c = blk(6, 7, 'b3'); put('ppd_ratio', a / c, 0); put('ppd_ratio_b2', a / b, 0);
  put('b1_layouts', MS[1], 0); put('b2_layouts', MS[6] - MS[5], 0); put('b3_layouts', MS[7] - MS[6], 0); put('b2_from', MS[5], 0); put('b2_to', MS[6], 0);
  put('bench_h', 256 * HL, 2); put('tw_cost256', 256 * perLayout('twin'), 2); put('sim_cost256', 256 * perLayout('sim'), 2);
  put('sat_old', pc(TAB.old.s[7]), 1); put('sat_s1', pc(TAB['sim0.01'].s[7]), 1); put('sat_video', pc(TAB.video.s[7]), 1); put('sat_s3', pc(TAB['sim0.003'].s[7]), 1);
  check(a / c > 50 && a / c < 90, 'the first layouts of the twin buy about 70 times the success per dollar of the last 128 (got ' + a / c + ')'); }
{ const r = TAB.old.rho; put('old_rho16', r[3], 2); put('old_rho256', r[7], 2); put('old_cph16', priceH.old / r[3], 1); put('old_cph256', priceH.old / r[7], 1); put('old_cph_ratio', r[3] / r[7], 1);
  put('old_rho64', r[5], 2); put('old_cph64', priceH.old / r[5], 1); put('own_cph', priceH.own, 1);
  check(r[3] / r[7] > 4 && r[3] / r[7] < 5, 'the older arm\'s useful hour is about 4.5 times dearer at 256 layouts than at 16'); }

/* ───── 2. why the value falls ───── */
{ const e = (n) => 1 - cur.hand[GRID.indexOf(n)], share = (a, b) => 100 * (1 - Math.pow(e(b) / e(a), 1 / (b - a))), loc = (a, b) => Math.log(e(a) / e(b)) / Math.log(b / a);
  put('rem_8_16', share(8, 16), 1); put('rem_16_32', share(16, 32), 1); put('rem_32_64', share(32, 64), 1); put('rem_64_128', share(64, 128), 1); put('rem_128_256', share(128, 256), 1); put('rem_16_64', share(16, 64), 1);
  put('loc_8_16', loc(8, 16), 2); put('loc_128_256', loc(128, 256), 2); put('loc_ratio', loc(128, 256) / loc(8, 16), 0); put('own_e8', pc(e(8)), 1); put('own_e16', pc(e(16)), 1); put('own_e64', pc(e(64)), 1); put('own_e256', pc(e(256)), 1);
  put('own_s64', pc(cur.hand[GRID.indexOf(64)]), 1); put('own_s256', pc(cur.hand[GRID.indexOf(256)]), 1); put('own_s8', pc(cur.hand[GRID.indexOf(8)]), 1);
  put('nc_16_64', 1 / (share(16, 64) / 100), 0); put('nc_128_256', 1 / (share(128, 256) / 100), 0);
  check(share(16, 64) > 2 && share(16, 64) < 2.8 && share(128, 256) < 1.8 && share(128, 256) > 1.0, 'each own layout removes about 2.4 % of the failures that remain, 1.5 % at the top');
  check(loc(128, 256) > 5 * loc(8, 16), 'a power law would hold the local exponent of the error fixed; it grows more than fivefold'); }
{ // the ledger's helper, on the recomputed curves: error = A (h + h0)^-alpha + floor, fitted to the failures of each source's pool (points above 0 hours) and of the own curve from 8 layouts
  const r2s = [], TG = { twin: 'tw', old: 'ol', video: 'vi', 'sim0.003': 's3', 'sim0.01': 's1' };
  for (const key of ['twin', 'old', 'video', 'sim0.001', 'sim0.003', 'sim0.01']) { const h = MS.slice(1).map((m) => m * HL), err = TAB[key].s.slice(1).map((s) => 1 - s), f = LG.fitPower(h, err); r2s.push(f.r2); F['fp_r2_' + key.replace('.', '_')] = +f.r2.toFixed(3);
    if (TG[key]) { put('fa_' + TG[key], f.alpha, 2); put('ff_' + TG[key], pc(f.floor), 2); put('fr_' + TG[key], f.r2, 2); } }
  put('fp_r2_min', Math.min(...r2s), 2); put('fp_r2_max', Math.max(...r2s), 2);
  const f = LG.fitPower(GRID.slice(3).map((n) => n * HL), cur.hand.slice(3).map((s) => 1 - s)); put('fp_own_alpha', f.alpha, 2); put('fp_own_r2', f.r2, 2); put('fa_own', f.alpha, 2); put('ff_own', pc(f.floor), 2); put('fr_own', f.r2, 2); }
/* the rate of a source falls as a power of the hours bought: ln rate against ln hours, 8 to 256 attempted layouts, positive rates only */
function rateFit(rho) {
  const xs = [], yy = []; for (let i = 2; i < MS.length; i++) if (rho[i] > 0) { xs.push(Math.log(MS[i])); yy.push(Math.log(rho[i])); }
  const n = xs.length; if (n < 2) return { gamma: NaN, beta: NaN, k: NaN, r2: NaN };
  const mx = xs.reduce((a, b) => a + b) / n, my = yy.reduce((a, b) => a + b) / n; let sxx = 0, sxy = 0, syy = 0;
  for (let i = 0; i < n; i++) { sxx += (xs[i] - mx) ** 2; sxy += (xs[i] - mx) * (yy[i] - my); syy += (yy[i] - my) ** 2; }
  return { gamma: -sxy / sxx, beta: 1 + sxy / sxx, k: Math.exp(my - sxy / sxx * mx), r2: sxy * sxy / (sxx * syy) };
}
const FIT = {};
for (const [key, tag] of [['twin', 'tw'], ['sim0.003', 's3'], ['sim0.01', 's1'], ['old', 'ol'], ['video', 'vi']]) {
  const f = FIT[key] = rateFit(TAB[key].rho); put('g_' + tag, f.gamma, 2); put('r2_' + tag, f.r2, 2); put('k_' + tag, f.k, 3); put('beta_' + tag, f.beta, 3);
  put('rho16_' + tag, TAB[key].rho[3], 2); put('rho256_' + tag, TAB[key].rho[7], 2); put('rho8_' + tag, TAB[key].rho[2], 2);
}
check(FIT.twin.gamma < 0.15 && FIT['sim0.01'].gamma > 0.25 && FIT.old.gamma > 0.3 && FIT.old.gamma < 0.5, 'the rate of the same-make arm barely falls, that of the 1 % simulator and the older arm falls as a power');
check(FIT.video.r2 < 0.3, 'footage\'s rates are too noisy to carry an exponent');
put('video_best_rho', Math.max(...TAB.video.rho.slice(2)), 2); put('video_best_cph', priceH.video / Math.max(...TAB.video.rho.slice(2)), 0);

/* ───── 3. the rule: the cost of the next useful hour, from the fits ───── */
const perUseful = (cost, f, m) => cost / (f.k * f.beta * Math.pow(m, f.beta - 1)) / HL;     // dollars per useful hour of the next layout after m attempted ones
const MC = { sim: ['sim0.01', 'sim'], twin: ['twin', 'twin'], old: ['old', 'old'], video: ['video', 'video'] };
for (const [tag, [key, pk]] of Object.entries(MC)) for (const m of [8, 64, 256]) put('mc_' + tag + '_' + m, perUseful(perLayout(pk), FIT[key], m), tag === 'sim' ? 2 : 1);
put('mc_own', priceH.own, 1);
{ const a = FIT.old, cr = Math.pow(perLayout('own') * a.k * a.beta / perLayout('old'), 1 / (1 - a.beta)); put('cross_old_own', cr, 0);
  check(perUseful(perLayout('sim'), FIT['sim0.01'], 8) < perUseful(perLayout('twin'), FIT.twin, 8) && perUseful(perLayout('twin'), FIT.twin, 8) < perUseful(perLayout('old'), FIT.old, 8) && perUseful(perLayout('old'), FIT.old, 8) < priceH.own && priceH.own < perUseful(perLayout('video'), FIT.video, 8), 'at 8 layouts the next useful hour is cheapest from the simulator, then the twin, the older arm, your own arm, footage');
  check(Math.abs(perUseful(perLayout('old'), FIT.old, 256) / priceH.own - 1) < 0.05, 'at 256 layouts the older arm\'s next useful hour costs what your own does');
  put('mc_old_vs_own_256', perUseful(perLayout('old'), FIT.old, 256) / priceH.own, 2); put('old_vs_own_8', priceH.own / perUseful(perLayout('old'), FIT.old, 8), 1);
  put('mc_ratio_tw_sim_256', perUseful(perLayout('twin'), FIT.twin, 256) / perUseful(perLayout('sim'), FIT['sim0.01'], 256), 0); put('mc_own_ok', priceH.own, 1); }
{ // the closed form of the rule against a numerical optimum: two sources G_a = k_a h^b_a, G_b = k_b h^b_b, a budget; F' cancels, so maximise G_a + G_b
  const ka = 1.6, ba = 0.6, kb = 1.7, bb = 0.89, pa = 0.04, pb = 0.04 * 3, B = 5;
  const mu = (() => { let lo = 1e-6, hi = 1e6; for (let it = 0; it < 300; it++) { const mid = Math.sqrt(lo * hi), sp = pa * Math.pow(ka * ba / (mid * pa), 1 / (1 - ba)) + pb * Math.pow(kb * bb / (mid * pb), 1 / (1 - bb)); if (sp > B) lo = mid; else hi = mid; } return hi; })();
  const ha = Math.pow(ka * ba / (mu * pa), 1 / (1 - ba)), hb = Math.pow(kb * bb / (mu * pb), 1 / (1 - bb)), G = (h, k, b) => k * Math.pow(h, b);
  let best = -1, bestA = 0; for (let x = 0; x <= B / pa; x += 0.05) { const y = (B - pa * x) / pb, g = G(x, ka, ba) + G(y, kb, bb); if (g > best) { best = g; bestA = x; } }
  put('cf_ha', ha, 1); put('cf_brute_ha', bestA, 1); check(Math.abs(ha - bestA) < 0.2 && Math.abs(G(ha, ka, ba) + G(hb, kb, bb) - best) < 1e-3, 'the closed form of the rule equals a numerical optimum');
  { const kA = 3, kB = 2, pA = 12, pB = 3, Bk = 48; // dE/dh = k / (2 sqrt h): equal per dollar gives sqrt(hA) / sqrt(hB) = (kA pB) / (kB pA)
    const rr = (kA * pB) / (kB * pA), hB = Bk / (pA * rr * rr + pB), hA = rr * rr * hB, E = (h) => kA * Math.sqrt(h[0]) + kB * Math.sqrt(h[1]);
    put('ck_ha', hA, 2); put('ck_hb', hB, 2); put('ck_spa', pA * hA, 2); put('ck_spb', pB * hB, 2); put('ck_e', E([hA, hB]), 1); put('ck_ratio', rr * rr, 4);
    put('ck_lam', kA / (2 * Math.sqrt(hA) * pA), 4); check(Math.abs(kA / (2 * Math.sqrt(hA) * pA) - kB / (2 * Math.sqrt(hB) * pB)) < 1e-12, 'equal marginal value per dollar at the checkpoint optimum');
    put('ck_allb', E([0, Bk / pB]), 1); put('ck_alla', E([Bk / pA, 0]), 1); put('ck_equal', E([Bk / 2 / pA, Bk / 2 / pB]), 2);
    let bestE = 0; for (let x = 0; x <= Bk / pA; x += 0.001) bestE = Math.max(bestE, E([x, (Bk - pA * x) / pB])); check(Math.abs(bestE - E([hA, hB])) < 1e-4, 'the checkpoint optimum equals a brute-force search'); }
  put('ck_price', Math.pow(2, 1 / (1 - 0.6)), 1); put('ck_price_twin', Math.pow(2, 1 / (1 - 0.89)), 0); put('ck_mc', Math.pow(256 / 16, 0.4), 2); }

/* ───── 4. a pool is not a sum: the policy scores the pools (draw 7) ───── */
const DRAW = 7, OT = 'sim0.01', cT = perLayout('twin'), cO = perLayout('sim');
const P = (n, m, other, draw) => poolOf(draw === undefined ? DRAW : draw, other || OT, NA, n, m);
{ put('p_base', pc(P(0, 0).succ), 1); put('p_twin256', pc(P(256, 0).succ), 1); put('p_sim256', pc(P(0, 256).succ), 1); put('p_both', pc(P(256, 256).succ), 1);
  put('p_up', pc(P(0, 256).succ - P(0, 0).succ), 1); put('p_down', pc(P(256, 256).succ - P(256, 0).succ), 1); put('p_down_abs', pc(P(256, 0).succ - P(256, 256).succ), 1);
  const r = P(256, 256), sh = (role) => pc((r.pick[role] || 0) / NT), rel = (role) => pc((r.good[role] || 0) / (r.pick[role] || 1));
  put('mech_so', sh('other'), 1); put('mech_st', sh('twin'), 1); put('mech_sw', sh('own'), 1); put('mech_ro', rel('other'), 1); put('mech_rt', rel('twin'), 1); put('mech_rw', rel('own'), 1);
  const sum = (r.good.own || 0) + (r.good.twin || 0) + (r.good.other || 0); check(sum === r.ok, 'the successes split by the source of the nearest layout add up');
  check(P(256, 256).succ < P(256, 0).succ - 0.03, 'a simulator layout pool at 1 % gap lowers a pool that already holds 256 twin layouts by more than 3 points');
  check(P(0, 256).succ > P(0, 0).succ + 0.5, 'and raises 8 own layouts by more than 50 points');
  // the value of a block of the simulator's layouts, per dollar, at two pools
  const blk = (a, b, cost, n) => 100 * (a - b) / cost; put('blk_sim_base', blk(P(0, 64).succ, P(0, 0).succ, 64 * cO), 0); put('blk_sim_pool', blk(P(256, 64).succ, P(256, 0).succ, 64 * cO), 0); put('blk_twin_base', blk(P(64, 0).succ, P(0, 0).succ, 64 * cT), 1);
  put('blk_sim_base_gain', pc(P(0, 64).succ - P(0, 0).succ), 1); put('blk_sim_pool_gain', pc(P(256, 64).succ - P(256, 0).succ), 1); put('blk_twin_base_gain', pc(P(64, 0).succ - P(0, 0).succ), 1); put('blk_sim_cost', 64 * cO, 3); put('blk_twin_cost', 64 * cT, 2);
  put('blk_ratio', (P(0, 64).succ - P(0, 0).succ) / (64 * cO) / ((P(64, 0).succ - P(0, 0).succ) / (64 * cT)), 0);
  check(Math.abs(Object.keys(r.pick).reduce((a, k) => a + (r.good[k] || 0), 0) / NT - r.succ) < 1e-12, 'success is the sum over sources of share times reliability'); }
/* the model of section 3 (own-layout curve read at the sum of the equivalents the table gives each source) against the policy, at the best split of $3 */
function ownAt(E) { const xs = [0].concat(GRID), ysr = [0]; for (let i = 0; i < GRID.length; i++) ysr.push(Math.max(ysr[i], LG.TABLE.layouts.ownHand.s[i])); if (E <= 0) return 0; for (let i = 1; i < xs.length; i++) if (E <= xs[i]) return ysr[i - 1] + (ysr[i] - ysr[i - 1]) * (E - xs[i - 1]) / (xs[i] - xs[i - 1]); return ysr[ysr.length - 1]; }
function eqv(key, m) { const r = LG.TABLE.layouts.src[key].rho[NA]; let x0 = 0, y0 = 0; for (let i = 1; i < MS.length; i++) { const y1 = r[i] * MS[i]; if (m <= MS[i]) return y0 + (y1 - y0) * (m - x0) / (MS[i] - x0); x0 = MS[i]; y0 = y1; } return y0; }
const model = (n, m, other) => ownAt(NA + eqv('twin', n) + eqv(OTHER[other || OT].tab, m));

/* the rule and the shortcuts on a budget, written again: every split, each source at most 256 layouts */
function splitAt(B, cTw, cOt, m, other, draw) { const spend = cOt * m; if (spend > B + 1e-9) return null; const n = Math.min(256, Math.floor((B - spend) / cTw + 1e-9)); const r = P(n, m, other, draw); return { m, n, succ: r.succ, spent: spend + cTw * n, r }; }
function bestOf(B, cTw, cOt, other, draw) { const top = Math.min(256, Math.floor(B / cOt + 1e-9)); let best = null; for (let m = 0; m <= top; m++) { const c = splitAt(B, cTw, cOt, m, other, draw); if (c && (!best || c.succ > best.succ)) best = c; } return best; }
function plan(n, m, other, draw) { const r = P(n, m, other, draw); return { m, n, succ: r.succ, r, spent: 0 }; }
function shortcuts(B, cTw, cOt, other, draw) {
  const out = {}, rT = TAB.twin.rho[5], rO = TAB[OTHER[other].tab].rho[5];                 // lesson 2's operating point: 8 own layouts, 64 attempted
  // all-in: every dollar on the cheaper hour by price (a tie goes to the other source), as far as its 256 layouts go
  { const o = cOt <= cTw, c = o ? cOt : cTw, k = Math.min(256, Math.floor(B / c + 1e-9)); out.allin = plan(o ? 0 : k, o ? k : 0, other, draw); out.allin.spent = c * k; }
  // equal split: half the budget to each, each capped at its 256 layouts
  { const mE = Math.min(256, Math.floor(B / 2 / cOt + 1e-9)), nE = Math.min(256, Math.floor(B / 2 / cTw + 1e-9)); out.equal = plan(nE, mE, other, draw); }
  // cascade down lesson 2's ranking: the lower price over rate first, to the end of its catalogue, then the other source
  { const cuT = cTw / rT, cuO = rO > 0 ? cOt / rO : Infinity; let m = 0, n = 0;
    if (cuO <= cuT) { m = Math.min(256, Math.floor(B / cOt + 1e-9)); n = Math.min(256, Math.floor((B - cOt * m) / cTw + 1e-9)); }
    else { n = Math.min(256, Math.floor(B / cTw + 1e-9)); if (isFinite(cuO)) m = Math.min(256, Math.floor((B - cTw * n) / cOt + 1e-9)); }
    out.cascade = plan(n, m, other, draw); }
  // to 90 % each: each source until it alone would take the pool to 90 % (all 256 if it never does), the cheaper by price first
  const need = (twinOnly) => { for (let j = 0; j <= 256; j += 4) if ((twinOnly ? P(j, 0, other, draw) : P(0, j, other, draw)).succ >= 0.9) return j; return 256; };
  let mT, nT, left = B;
  if (cOt <= cTw) { mT = Math.min(need(false), Math.floor(left / cOt + 1e-9)); left -= cOt * mT; nT = Math.min(need(true), Math.floor(left / cTw + 1e-9)); }
  else { nT = Math.min(need(true), Math.floor(left / cTw + 1e-9)); left -= cTw * nT; mT = Math.min(need(false), Math.floor(left / cOt + 1e-9)); }
  out.target = plan(nT, mT, other, draw); out.target.spent = cOt * mT + cTw * nT;
  out.equal.spent = cOt * out.equal.m + cTw * out.equal.n; out.cascade.spent = cOt * out.cascade.m + cTw * out.cascade.n;
  return out;
}
const BUD = [0.1, 0.2, 0.3, 0.5, 0.75, 1, 1.5, 2, 3, 4, 5, 6, 8, 10, 12];
for (const B of [0.1, 0.5, 1, 3, 6, 10]) {
  const key = 'b' + String(B).replace('.', '_'), b = bestOf(B, cT, cO, OT), s = shortcuts(B, cT, cO, OT);
  put(key + '_best', pc(b.succ), 1); put(key + '_m', b.m, 0); put(key + '_n', b.n, 0); put(key + '_spent', b.spent, 2);
  for (const k of ['allin', 'equal', 'target', 'cascade']) put(key + '_' + k, pc(s[k].succ), 1);
  put(key + '_target_spent', s.target.spent, 2); put(key + '_equal_spent', s.equal.spent, 2); put(key + '_cascade_spent', s.cascade.spent, 2); put(key + '_cascade_m', s.cascade.m, 0); put(key + '_cascade_n', s.cascade.n, 0); put(key + '_cascade_gap', pc(b.succ - s.cascade.succ), 1); put(key + '_equal_gap', pc(b.succ - s.equal.succ), 1); put(key + '_target_gap', pc(b.succ - s.target.succ), 1); put(key + '_allin_gap', pc(b.succ - s.allin.succ), 1);
  put(key + '_equal_m', s.equal.m, 0); put(key + '_equal_n', s.equal.n, 0); put(key + '_target_m', s.target.m, 0); put(key + '_target_n', s.target.n, 0);
  if (B === 3) { put('model_3', pc(model(b.n, b.m)), 1); put('model_gap_3', pc(model(b.n, b.m) - b.succ), 1); }
}
check(F.b6_cascade_gap > 3 && F.b10_cascade_gap > 3, 'at $6 and $10 the best split beats the cascade down lesson 2\'s ranking by more than 3 points');
check(F.b10_m <= 4 && F.b6_m <= 4, 'at $6 and $10 the best split buys (almost) none of the 1 % simulator (' + F.b6_m + ', ' + F.b10_m + ')');
check(F.b1_m > 150 && F.b0_1_m > 150, 'at $1 and below the best split buys most of the simulator\'s layouts');
check(F.b10_best > 98 && F.b10_equal < F.b10_best - 5 && F.b10_target < F.b10_best - 5 && F.b10_allin < F.b10_best - 10, 'at $10 each of the three shortcuts loses by the margins the prose quotes');

/* ───── the sentences of the prose that are not a single number, as checks ───── */
check(F.sat_video < F.sat_old && F.sat_old < F.sat_s1 && F.sat_s1 < F.tw_s256, 'the poorer the source, the lower its pool saturates (footage < older arm < 1 % simulator < twin)');
check(F.mc_sim_256 / F.mc_sim_8 > 2.5 && F.mc_sim_256 / F.mc_sim_8 < 3.5, 'the simulator\'s next useful hour about triples from 8 to 256 layouts');
check(F.b1_cascade_gap <= 0.15 && F.b1_target_gap <= 0.15, 'at $1 the ranking and the 90 % rule are within 0.1 point of the best split');
check(F.b1_allin === F.b3_allin && F.b3_allin === F.b6_allin && F.b6_allin === F.b10_allin, 'all on the simulator is the same pool at every budget from $1: its 256 layouts run out');
for (const B of ['1', '3', '6', '10']) check(F['b' + B + '_cascade'] >= F['b' + B + '_allin'] && F['b' + B + '_cascade'] >= F['b' + B + '_equal'] && F['b' + B + '_cascade'] >= F['b' + B + '_target'] - 1e-9, 'lesson 2\'s ranking is the best of the four rules at $' + B);
check(F.fa_own / F.fa_vi > 9 && F.fa_own / F.fa_vi < 11 && ['own', 'tw', 'ol', 'vi', 's3', 's1'].every((t) => F['ff_' + t] === 0), 'the exponents of the power-law-with-floor fits differ tenfold and the best floor is zero each time');
check(F.fr_own > 0.9 && F.fr_tw >= 0.9 && F.fr_ol >= 0.9 && F.fr_vi >= 0.9 && F.fr_s3 >= 0.9 && F.fr_s1 >= 0.9, 'a power law with a floor fits every success curve at R² of 0.9 or more');
check(F.sim_cost256 === 0.12 && F.b6_target_spent < 6 && F.b10_equal_spent < 5.5 && F.b10_equal_spent > 5, 'the dollars of the rules that leave money over');

/* ───── eight draws of the layouts: what is robust ───── */
{ const dr = []; for (let d = 0; d < 8; d++) {
    const r = { twin: P(256, 0, OT, d).succ, sim: P(0, 256, OT, d).succ, both: P(256, 256, OT, d).succ };
    let sw = null; for (const B of [2, 3, 4, 5, 6, 8, 10]) { const b = bestOf(B, cT, cO, OT, d); if (B === 10) { r.m10 = b.m; r.best10 = b.succ; r.gap10 = b.succ - shortcuts(10, cT, cO, OT, d).cascade.succ; } if (sw === null && b.m < 32) sw = B; }
    r.sw = sw; dr.push(r); }
  const col = (k) => dr.map((r) => r[k]), lo = (k) => Math.min(...col(k)), hi = (k) => Math.max(...col(k)), med = (a) => a.slice().sort((x, y) => x - y)[3] / 2 + a.slice().sort((x, y) => x - y)[4] / 2;
  put('dr_twin_lo', pc(lo('twin')), 1); put('dr_twin_hi', pc(hi('twin')), 1); put('dr_sim_lo', pc(lo('sim')), 1); put('dr_sim_hi', pc(hi('sim')), 1); put('dr_both_lo', pc(lo('both')), 1); put('dr_both_hi', pc(hi('both')), 1);
  put('dr_sw_lo', lo('sw'), 0); put('dr_sw_hi', hi('sw'), 0); put('dr_m10_max', hi('m10'), 0); put('dr_best10_lo', pc(lo('best10')), 1); put('dr_best10_hi', pc(hi('best10')), 1); put('dr_gap10_lo', pc(lo('gap10')), 1); put('dr_gap10_hi', pc(hi('gap10')), 1);
  put('dr_down_lo', pc(Math.min(...dr.map((r) => r.twin - r.both))), 1); put('dr_down_hi', pc(Math.max(...dr.map((r) => r.twin - r.both))), 1);
  check(dr.every((r) => r.both < r.twin - 0.02), 'on every draw 256 simulated layouts lower the pool of 256 twin layouts by at least 2 points');
  check(dr.every((r) => r.m10 <= 4), 'on every draw the best split of $10 buys at most four simulated layouts');
  check(dr.every((r) => r.gap10 > 0.02), 'on every draw the best split of $10 beats the cascade by more than 2 points');
  check(Math.abs(dr[DRAW].twin - med(col('twin'))) < 0.006 && Math.abs(dr[DRAW].sim - med(col('sim'))) < 0.008 && Math.abs(dr[DRAW].both - med(col('both'))) < 0.006 && dr[DRAW].sw === 4, 'draw 7 sits at the medians of the eight (twin ' + dr[DRAW].twin + ' vs ' + med(col('twin')) + ', sim ' + dr[DRAW].sim + ' vs ' + med(col('sim')) + ', both ' + dr[DRAW].both + ' vs ' + med(col('both')) + ')'); }

/* ───── the states of the widget that the prose walks through, computed here and compared with what the page prints ───── */
const TPS = [priceH.twin / 4, priceH.twin / 2, priceH.twin, priceH.twin * 2, priceH.twin * 4, priceH.own];
const STATES = [
  ['d', 8, 2, 'sim0.01'], ['d1', 5, 2, 'sim0.01'], ['d6', 11, 2, 'sim0.01'], ['d10', 13, 2, 'sim0.01'], ['d01', 0, 2, 'sim0.01'], ['d05', 3, 2, 'sim0.01'],
  ['o3', 8, 5, 'old'], ['o6', 11, 5, 'old'], ['o10', 13, 5, 'old'],
  ['t3', 8, 4, 'sim0.01'], ['t6', 11, 4, 'sim0.01'],
  ['j6', 11, 2, 'sim0.03'], ['h3', 8, 2, 'simH0.03'], ['h6', 11, 2, 'simH0.03'], ['e3', 8, 2, 'sim0.003'], ['v6', 11, 2, 'video'], ['v10', 13, 2, 'video'],
];
const SI = {};
for (const [tag, bi, ti, other] of STATES) {
  const B = BUD[bi], cTw = TPS[ti] * HL, cOt = perLayout(OTHER[other].price), b = bestOf(B, cTw, cOt, other, DRAW), s = shortcuts(B, cTw, cOt, other, DRAW), r = b.r;
  const fo = rateFit(TAB[OTHER[other].tab].rho), okFit = isFinite(fo.k) && fo.beta > 0;
  SI[tag] = { B, ti, other, cTw, cOt, b, s, r, mct: perUseful(cTw, FIT.twin, Math.min(256, Math.max(8, b.n))), mco: okFit ? perUseful(cOt, fo, Math.min(256, Math.max(8, b.m))) : NaN };
  const q = 'x_' + tag + '_';
  put(q + 'best', pc(b.succ), 1); put(q + 'm', b.m, 0); put(q + 'n', b.n, 0); put(q + 'spent', b.spent, 2); put(q + 'model', pc(model(b.n, b.m, other)), 1);
  for (const k of ['allin', 'equal', 'target', 'cascade']) put(q + k, pc(s[k].succ), 1);
  put(q + 'so', pc((r.pick.other || 0) / NT), 1); put(q + 'ro', pc((r.good.other || 0) / (r.pick.other || 1)), 1); put(q + 'st', pc((r.pick.twin || 0) / NT), 1); put(q + 'rt', pc((r.good.twin || 0) / (r.pick.twin || 1)), 1);
  put(q + 'gap', pc(b.succ - s.cascade.succ), 1); put(q + 'mct', SI[tag].mct, 2); if (okFit) put(q + 'mco', SI[tag].mco, 2);
}
check(SI.j6.b.m === 0, 'with the 3 % simulator and joint labels the best split buys none of it');
check(Math.abs(F.x_h3_best - F.x_h3_model) < 1 && F.x_h3_ro >= 99 && F.x_h3_gap <= 0.15, 'with hand labels the 3 % simulator adds as the sum model says and the ranking is within 0.1 point of the best split');
check(SI.d.b.m > 100 && SI.d.b.n > 50, 'at $3 the best split of the default state buys both sources');
check(SI.d6.b.m === 0 && SI.d10.b.m === 0, 'at $6 and $10 the default best split buys no simulator layouts');

/* ───── the widget prints what the independent computation gives ───── */
const html = path.join(root, dir, '03_diminishing_returns.html');
if (fs.existsSync(html)) {
  const pg = loadPage(html);
  pg.problems.forEach((p) => fail('page problem: ' + p));
  // the widget fits the rates the table stores (four decimals), this oracle fits the rates it recomputed (they agree to 1.5e-4): marginal costs may differ in the fourth digit, hence the relative slack
  const eqd = (id, want, digits, what, rel) => { const got = pg.num(id); if (!(Math.abs(got - want) <= 0.5 * Math.pow(10, -digits) + 1e-9 + (rel || 0) * Math.abs(want))) fail(`${what}: widget #${id} prints ${got}, independent computation gives ${want.toFixed(digits + 2)}`); };
  const probe = (tag, name) => {
    const q = SI[tag], b = q.b; pg.set('w03-bud', STATES.find((x) => x[0] === tag)[1]); pg.set('w03-tp', q.ti); pg.set('w03-oth', q.other); pg.drain();
    const r = q.r, so = (role) => (r.pick[role] || 0) / NT;
    eqd('w03-spent', b.spent, 2, name + ' spent'); eqd('w03-m', b.m, 0, name + ' layouts of the other source'); eqd('w03-n', b.n, 0, name + ' twin layouts'); eqd('w03-best', pc(b.succ), 1, name + ' best split');
    eqd('w03-model', pc(model(b.n, b.m, q.other)), 1, name + ' model'); for (const k of ['allin', 'equal', 'target', 'cascade']) eqd('w03-' + k, pc(q.s[k].succ), 1, name + ' ' + k);
    if (b.m > 0 && r.pick.other) { eqd('w03-so', pc(so('other')), 1, name + ' share of the other'); eqd('w03-ro', pc(r.good.other / r.pick.other), 1, name + ' reliability of the other'); }
    if (r.pick.twin) { eqd('w03-st', pc(so('twin')), 1, name + ' share of the twin'); eqd('w03-rt', pc(r.good.twin / r.pick.twin), 1, name + ' reliability of the twin'); }
    eqd('w03-mct', q.mct, 2, name + ' marginal cost of a useful twin hour', 3e-4);
    if (isFinite(q.mco)) eqd('w03-mco', q.mco, 2, name + ' marginal cost of a useful hour of the other', 3e-4); else if (!/–/.test(pg.text('w03-mco'))) fail(name + ': the marginal-cost readout of a source with no positive rate should read –, it reads ' + pg.text('w03-mco'));
  };
  for (const st of STATES) probe(st[0], 'state ' + st[0]);
}

console.log(JSON.stringify({ facts: F }));
process.exit(bad ? 1 : 0);
