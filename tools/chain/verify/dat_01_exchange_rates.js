#!/usr/bin/env node
'use strict';
/* Oracle for embodied_training_data lesson 01 (exchange rates).
 * Re-derives every number the lesson quotes with code written separately from exchange_lab.js and bodies_lab.js: its own recorder of demonstrations (an explicit plant, the footage's
 * label noise, the simulators' link lengths), its own policy rollout (per-chunk lookups over plain arrays, layout distance read off the posts of the two worlds), its own inversion of the
 * own curve (a forward map and a bisection, not the engine's segment search), its own Wilson interval, and, for the contact block, its own funnel, contact force, attempt and
 * kernel learner.  Only the world's primitives (arm, expert, posts, collision, the random stream) and the constants IL.P come from the shared code.  It then
 *   - recomputes the table cells the lesson quotes and asserts that LG.TABLE (the ledger), the engine and this independent path agree,
 *   - redraws both sets of layouts twelve times to put an error bar on a rate that the test layouts alone cannot give,
 *   - asserts every claim of the prose that can be checked (orderings on every draw, the control, the floor, the closed form of the label gap, the structural zero),
 *   - drives the page's widget through the states the prose names and checks what it prints.
 * Last stdout line: {"facts": {...}}. */
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '../../../all_lessons');
const dir = fs.existsSync(path.join(root, 'embodied_training_data_new')) ? 'embodied_training_data_new' : 'embodied_training_data';
const BN = require(path.join(root, dir, 'bench.js'));
const LG = require(path.join(root, dir, 'ledger.js'));
const IL = require(path.join(root, dir, 'insertion_lab.js'));         // only for the constants IL.P
const { loadPage } = require('../dom_probe.js');

let bad = 0;
const fail = (m) => { bad++; console.error('FAIL ' + m); };
const check = (c, m) => { if (!c) fail(m); };
const F = {};
const put = (k, v, d) => { F[k] = +(+v).toFixed(d === undefined ? 6 : d); };
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;

/* ─────────────────────────── the layouts experiment, written out independently ─────────────────────────── */
const DT = 0.05, JIT = 0.01, GUST = 0.08, CH = 16, KST = 20, NT = 1000, NFILE = 256, EV = 5, SEC = 9.3;
const GRID = [1, 2, 4, 8, 12, 16, 24, 32, 48, 64, 96, 128, 192, 256], MS = [4, 8, 16, 32, 64, 128, 256], BASES = [8, 32];
const clip = (x) => Math.max(-1.5, Math.min(1.5, x));
const BODY = {
  A: { L1: 0.5, L2: 0.5, gain: 0.85 },
  twin: { L1: 0.5, L2: 0.5 },
  old: { L1: 0.5, L2: 0.5, rgain: 0.85, lag: 0.1, noise: 0.12 },
  video: { L1: 0.5, L2: 0.5, rgain: 0.85, lag: 0, noise: 0.12, labelNoise: 0.003 },
};
for (const g of [0.001, 0.003, 0.01, 0.03]) BODY['sim' + g] = { L1: 0.5 * (1 + g), L2: 0.5 * (1 - g) };
const SRC = [['twin', 'twin', 'hand', 'tw'], ['old', 'old', 'hand', 'ol'], ['video', 'video', 'hand', 'vd'], ['sim0.001', 'sim0.001', 'joint', 's01'], ['sim0.003', 'sim0.003', 'joint', 's03'],
  ['sim0.01', 'sim0.01', 'joint', 's1'], ['sim0.03', 'sim0.03', 'joint', 's3'], ['simH0.03', 'sim0.03', 'hand', 'h3']];
const BODIES = ['twin', 'old', 'video', 'sim0.001', 'sim0.003', 'sim0.01', 'sim0.03'];

function layouts(n, seed) { const r = BN.rng(seed), out = []; for (let i = 0; i < n; i++) { const s = (2 * r() - 1) * 0.10, t = (2 * r() - 1) * 0.20; out.push([s, t]); } return out; }
const worldOf = (th, b) => BN.slalom.world(5, { shift: th[0], tilt: th[1], body: { L1: b.L1, L2: b.L2 } });
const postY = new Map();                                    // the heights of the five posts of a layout, read off the world itself
function ys(th) { let v = postY.get(th); if (!v) { v = worldOf(th, BODY.A).posts.map((p) => p[1]); postY.set(th, v); } return v; }
function dist(a, b) { const ya = ys(a), yb = ys(b); let m = 0; for (let i = 0; i < 5; i++) m = Math.max(m, Math.abs(ya[i] - yb[i])); return m; }

/* a demonstration, with the plant written out: realised velocity = gain x clipped command (first-order lag if any), plus the servo's gust, every step; footage adds the tracker's noise to the hand's positions */
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
  if (body.labelNoise) { const r = BN.rng(seed * 7 + 3); for (let i = 0; i < P.length; i++) P[i] = [P[i][0] + body.labelNoise * BN.randn(r), P[i][1] + body.labelNoise * BN.randn(r)]; }
  return { th, Q, P, n: Q.length, ok: done && !coll, coll, done, body };
}
function fileOf(body, thetas, m) { const out = []; for (let k = 0; k < m; k++) { const d = record(body, thetas[k], 500 + k); if (d.ok) { d.k = k; out.push(d); } } return out; }
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
/* success of a pooled set on the test layouts (trust weight 1: a stored layout of either kind is picked if it is the nearest) */
function pooled(own, foreign, space, tests) {
  let ok = 0;
  tests.forEach((th, k) => {
    let best = null, bd = Infinity;
    for (const d of own) { const x = dist(th, d.th); if (x < bd) { bd = x; best = d; } }
    for (const d of foreign) { const x = dist(th, d.th); if (x < bd) { bd = x; best = d; } }
    if (follow(th, best, space, 1000 * EV + k + 1) === 'done') ok++;
  });
  return { N: tests.length, ok, succ: ok / tests.length, ci: wilson(ok, tests.length) };
}

/* the own curve as a ruler: a forward map (the running maximum of the measured curve, the origin below its first point, the last segment extended) and its inverse by bisection */
function envelope(S) { const x = [0], y = [0]; let m = 0; for (let i = 0; i < GRID.length; i++) { m = Math.max(m, S[i]); x.push(GRID[i]); y.push(m); } return { x, y }; }
function ownAt(env, N) { const { x, y } = env; if (N <= 0) return 0; let i = 1; while (i < x.length - 1 && N > x[i]) i++; return y[i - 1] + (y[i] - y[i - 1]) * (N - x[i - 1]) / (x[i] - x[i - 1]); }
function invert(env, s) { if (s <= 0) return 0; let lo = 0, hi = 1e7; for (let it = 0; it < 200; it++) { const mid = (lo + hi) / 2; if (ownAt(env, mid) >= s) hi = mid; else lo = mid; } return hi; }

/* everything for one draw of the two sets of layouts (the test layouts, seed 99, are the same in every draw) */
const tests = layouts(NT, 99);
function build(ownSeed, forSeed, ms) {
  const ownTh = layouts(NFILE, ownSeed), forTh = layouts(NFILE, forSeed), own = fileOf(BODY.A, ownTh, NFILE);
  const cur = {}, env = {}; for (const sp of ['hand', 'joint']) { cur[sp] = GRID.map((n) => pooled(own.slice(0, n), [], sp, tests).succ); env[sp] = envelope(cur[sp]); }
  const files = {}; for (const b of BODIES) files[b] = fileOf(BODY[b], forTh, NFILE);
  const memo = {};
  const cell = (key, na, m) => {
    const id = key + '|' + na + '|' + m; if (memo[id]) return memo[id];
    const S = SRC.find((s) => s[0] === key), body = S[1], sp = S[2], fd = files[body].filter((d) => d.k < m), r = pooled(own.slice(0, na), fd, sp, tests);
    const neq = invert(env[sp], r.succ), rho = (neq - na) / m, rlo = (invert(env[sp], r.ci[0]) - na) / m, rhi = (invert(env[sp], r.ci[1]) - na) / m;
    return (memo[id] = { s: r.succ, lo: r.ci[0], hi: r.ci[1], neq, rho, rlo, rhi, kept: fd.length, frames: fd.reduce((a, d) => a + d.n, 0), ok: r.ok });
  };
  return { own, ownTh, forTh, cur, env, files, cell };
}

/* ─────────────────────────── the main draw (the one the widget and the ledger use) ─────────────────────────── */
const main = build(1011, 2024);
const CODE = {}; SRC.forEach((s) => { CODE[s[0]] = s[3]; });
const SPACE = {}; SRC.forEach((s) => { SPACE[s[0]] = s[2]; });
// the unit
put('sec_demo', SEC, 1); put('dph', 3600 / SEC, 1); put('min_256', 256 * SEC / 60, 1); put('h_256', 256 * SEC / 3600, 2); put('min_64', 64 * SEC / 60, 1); put('sec_8', 8 * SEC, 1); put('min_32', 32 * SEC / 60, 1);
// the own curve
GRID.forEach((n, i) => { put('own_' + n, main.cur.hand[i] * 100, 2); put('ownj_' + n, main.cur.joint[i] * 100, 2); });
put('own_dip_gap', (main.cur.hand[1] - main.cur.hand[2]) * 100, 2);
put('own_gain_128_256', (main.cur.hand[13] - main.cur.hand[11]) * 100, 1); put('own_gain_64_128', (main.cur.hand[11] - main.cur.hand[9]) * 100, 1); put('own_gain_32_64', (main.cur.hand[9] - main.cur.hand[7]) * 100, 1);
// every cell of the table
for (const [key, , , c] of SRC) for (const na of BASES) for (const m of MS) {
  const x = main.cell(key, na, m), id = `${c}_${na}_${m}`;
  put('s_' + id, x.s * 100, 3); put('sl_' + id, x.lo * 100, 3); put('sh_' + id, x.hi * 100, 3); put('q_' + id, x.neq, 4); put('r_' + id, x.rho, 6); put('rl_' + id, x.rlo, 6); put('rh_' + id, x.rhi, 6);
  put('k_' + id, x.kept, 0); put('f_' + id, x.frames, 0);
}
// the tally of the entry: 8 own layouts plus 256 attempted layouts of a source
put('t_own8', main.cur.hand[3] * 100, 1); put('t_own256', main.cur.hand[13] * 100, 1);
for (const [key, , , c] of SRC) put('t_' + c, main.cell(key, 8, 256).s * 100, 1);
put('t_spread', Math.max(...SRC.filter((s) => s[3] !== 'h3').map((s) => main.cell(s[0], 8, 256).s)) * 100 - main.cell('sim0.03', 8, 256).s * 100, 1);
// frames and what they say (m = 64, 8 own)
put('fr_ratio_ol_64', main.cell('old', 8, 64).frames / main.cell('twin', 8, 64).frames * 100, 1); put('fr_ratio_vd_64', main.cell('video', 8, 64).frames / main.cell('twin', 8, 64).frames * 100, 1);
put('fr_ratio_ol_256', main.cell('old', 8, 256).frames / main.cell('twin', 8, 256).frames * 100, 1);
put('fr_gap_s01_s3_64', Math.abs(main.cell('sim0.001', 8, 64).frames - main.cell('sim0.03', 8, 64).frames), 0);
put('fr_per_att_vd', main.cell('video', 8, 64).frames / 64, 0); put('fr_per_att_tw', main.cell('twin', 8, 64).frames / 64, 0);
put('fr_per_demo_vd', main.cell('video', 8, 64).frames / main.cell('video', 8, 64).kept, 0); put('fr_per_demo_tw', main.cell('twin', 8, 64).frames / main.cell('twin', 8, 64).kept, 0);
put('disc_vd_64', (64 - main.cell('video', 8, 64).kept) / 64 * 100, 0); put('disc_ol_64', (64 - main.cell('old', 8, 64).kept) / 64 * 100, 0);
put('disc_vd_256', (256 - main.cell('video', 8, 256).kept) / 256 * 100, 0); put('disc_ol_256', (256 - main.cell('old', 8, 256).kept) / 256 * 100, 0);
put('rho_vd_per_kept_64', main.cell('video', 8, 64).rho * 64 / main.cell('video', 8, 64).kept, 2);
// success gain against the own curve at the same total (the road not taken)
for (const na of BASES) for (const [key, , , c] of SRC.slice(0, 3)) put(`gain_${c}_${na}`, (main.cell(key, na, 64).s - main.cur.hand[GRID.indexOf(na)]) * 100, 1);
// the worked example (older arm, 8 own + 64 attempted): the inversion by hand
{ const x = main.cell('old', 8, 64), e = main.env.hand; put('wk_neq', x.neq, 1); put('wk_repl', x.neq - 8, 1); put('wk_rho', x.rho, 2); put('wk_min_src', 64 * SEC / 60, 1); put('wk_min_own', (x.neq - 8) * SEC / 60, 1);
  put('wk_neq_lo', invert(e, x.lo), 1); put('wk_neq_hi', invert(e, x.hi), 1);
  put('wk_32', main.cur.hand[7] * 100, 1); put('wk_48', main.cur.hand[8] * 100, 1);
  const interp = 32 + 16 * (x.s - main.cur.hand[7]) / (main.cur.hand[8] - main.cur.hand[7]); put('wk_interp', interp, 1); put('wk_floor', -8 / 64, 3); put('wk_floor32', -32 / 64, 3);
  check(Math.abs(interp - x.neq) < 1e-6, 'the worked example: the interpolation between 32 and 48 own layouts gives N_eq'); }
// sims: label gap in cm against the margin; the closed form 2 |delta| sin(q2/2)
const GAPRAW = {};
{ const clr = []; for (const d of main.own.slice(0, 64)) { const w = worldOf(d.th, BODY.A); let b = 9; for (const p of d.P) for (const c of w.posts) b = Math.min(b, Math.hypot(p[0] - c[0], p[1] - c[1])); clr.push((b - 0.05) * 100); }
  put('margin_cm', mean(clr), 2); put('margin_min_cm', Math.min(...clr), 2);
  for (const [key, body, , c] of SRC.filter((s) => s[3].startsWith('s') && s[3] !== 's')) {
    const f = main.files[body].slice(0, 16); let tot = 0, worst = 0;
    for (const d of f) { let ss = 0; for (let i = 0; i < d.n; i++) { const a = BN.arm.fk(d.Q[i], BODY.A), g = Math.hypot(a[0] - d.P[i][0], a[1] - d.P[i][1]); ss += g; const fm = 2 * Math.abs(BODY[body].L1 - 0.5) * Math.sin(Math.abs(d.Q[i][1]) / 2); worst = Math.max(worst, Math.abs(g - fm)); } tot += ss / d.n; }
    GAPRAW[c] = tot / f.length * 100; put('gap_' + c, GAPRAW[c], 3); check(worst < 1e-9, 'label gap of ' + key + ' equals 2 |delta| sin(q2/2) frame by frame (worst deviation ' + worst + ')'); }
  put('gap_ratio_s3', F.gap_s3 / F.margin_cm, 2); put('gap_ratio_s1', F.gap_s1 / F.margin_cm, 2); }
// the older arm and the footage: the length of a kept demonstration in seconds, against the expert's 9.3
put('sec_old', mean(main.files.old.map((d) => d.n)) * DT, 1); put('sec_vd', mean(main.files.video.map((d) => d.n)) * DT, 1); put('sec_tw', mean(main.files.twin.map((d) => d.n)) * DT, 1);
// break-even between two sources: the twin's hour is worth this many older-arm hours
put('ratio_tw_ol', main.cell('twin', 8, 64).rho / main.cell('old', 8, 64).rho, 1); put('inv_ratio_tw_ol', main.cell('old', 8, 64).rho / main.cell('twin', 8, 64).rho, 2);
put('neg_s3', -main.cell('sim0.03', 8, 64).rho, 2); put('s3_neq_64', main.cell('sim0.03', 8, 64).neq, 2);
// the hand-label simulator against the twin
put('d_h3_tw_64', main.cell('simH0.03', 8, 64).rho - main.cell('twin', 8, 64).rho, 3);

/* ─────────────────────────── twelve redraws of both sets of layouts ─────────────────────────── */
const DR = [];
for (let d = 0; d < 12; d++) {
  const b = build(1000 + d, 3000 + d), rec = { own8: b.cur.hand[3], own32: b.cur.hand[7], cells: {} };
  for (const [key] of SRC) for (const na of BASES) for (const m of [16, 64, 256]) rec.cells[`${key}|${na}|${m}`] = b.cell(key, na, m);
  DR.push(rec);
}
const dr = (key, na, m) => DR.map((r) => r.cells[`${key}|${na}|${m}`].rho);
for (const [key, , , c] of SRC) for (const na of BASES) for (const m of [16, 64, 256]) {
  const a = dr(key, na, m), id = `${c}_${na}_${m}`; put('dm_' + id, mean(a), 4); put('dl_' + id, Math.min(...a), 4); put('dh_' + id, Math.max(...a), 4);
}
put('draws', DR.length, 0);
for (const na of BASES) for (const c of ['tw', 'ol', 'vd']) { const key = SRC.find((s) => s[3] === c)[0]; put(`dg_${c}_${na}`, mean(DR.map((r) => r.cells[`${key}|${na}|64`].s - r[na === 8 ? 'own8' : 'own32'])) * 100, 1); }
put('d_twin_spread', (F.dh_tw_8_64 - F.dl_tw_8_64) / 2, 3);

/* ─────────────────────────── the contact block: a source that lacks a column ─────────────────────────── */
const P = IL.P, CDT = P.dt, NS = P.ns, CHs = CDT / NS, SLOPE = P.slope, SIG = Math.hypot(P.sigmaCam, P.sigmaArm), CZ = P.v / P.Fpush;
function funnel(c) { const h0 = c / 2, w = h0 + P.b, s0 = -SLOPE * P.b, poly = [[w + 100, 0], [w, 0], [h0, s0], [h0, -100], [w + 100, -100]]; return { h0, w, poly, kc: P.kc, segs: [[poly[0], poly[1]], [poly[1], poly[2]], [poly[2], poly[3]]] }; }
function inside(poly, px, pz) { let ins = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, zi] = poly[i], [xj, zj] = poly[j]; if ((zi > pz) !== (zj > pz) && px < (xj - xi) * (pz - zi) / (zj - zi) + xi) ins = !ins; } return ins; }
function nearestPt(seg, px, pz) { const [[ax, az], [bx, bz]] = seg, dx = bx - ax, dz = bz - az, t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz))); return [ax + t * dx, az + t * dz]; }
function contactForce(G, x, z, vx, vz) {
  const sg = x < 0 ? -1 : 1, u = Math.abs(x);
  if (!inside(G.poly, u, z)) return [0, 0];
  let bd = Infinity, bq = null;
  for (const seg of G.segs) { const q = nearestPt(seg, u, z), d = Math.hypot(q[0] - u, q[1] - z); if (d < bd) { bd = d; bq = q; } }
  const nu = bd > 1e-12 ? (bq[0] - u) / bd : 0, nz = bd > 1e-12 ? (bq[1] - z) / bd : 1, N = G.kc * bd, vt = sg * vx * (-nz) + vz * nu, fr = -P.mu * N * Math.tanh(vt / P.vreg);
  return [sg * (N * nu + fr * (-nz)), N * nz + fr * nu];
}
function attempt(G, pol, e0, FL, rn, keep) {
  const nT = Math.round(P.T / CDT), Kt = pol.K;
  let x = e0, z = P.z0, vx = 0, vz = 0, xc = 0, zc = P.z0, fx = 0, fz = 0, out = 'timeout', steps = nT;
  const tr = keep ? [] : null;
  for (let t = 0; t < nT; t++) {
    const u = pol.act({ t, z, d: xc, fx, fz });
    if (tr) tr.push({ x, z, fx, fz, d: xc, u });
    xc += u[0] * CDT; zc += u[1] * CDT;
    let cf = [0, 0];
    for (let s = 0; s < NS; s++) {
      cf = contactForce(G, x, z, vx, vz);
      const xn = (x * P.cd / CHs + Kt * (e0 + xc) + FL + cf[0]) / (P.cd / CHs + Kt), zn = (z * P.cd / CHs + Kt * zc + cf[1]) / (P.cd / CHs + Kt);
      vx = (xn - x) / CHs; vz = (zn - z) / CHs; x = xn; z = zn;
    }
    const Fm = Math.hypot(cf[0], cf[1]);
    fx = cf[0] + P.sigmaF * BN.randn(rn); fz = cf[1] + P.sigmaF * BN.randn(rn);
    if (Fm > P.Flim) { out = 'jam'; steps = t + 1; break; }
    if (z <= -P.Z) { out = 'in'; steps = t + 1; break; }
  }
  return { out, steps, tr };
}
function evaluateC(polFor, N, seed, keep) {
  const G = funnel(1), rn = BN.rng(seed + 7919), rh = BN.rng(seed), rolls = []; let nin = 0;
  for (let k = 0; k < N; k++) { const e0 = SIG * BN.randn(rh), FL = P.sigmaLoad * BN.randn(rh), r = attempt(G, polFor(k), e0, FL, rn, keep); rolls.push(r); if (r.out === 'in') nin++; }
  const ci = wilson(nin, N); return { succ: nin / N, lo: ci[0], hi: ci[1], rolls };
}
const holdP = () => ({ K: P.K, act: () => [0, -P.v] });
const yieldP = () => ({ K: P.K, act: (ob) => { const uz = Math.max(-P.v, Math.min(P.v, -CZ * (P.Fpush - ob.fz))), f = ob.fx, d = Math.abs(f) < P.fdead ? 0 : f - Math.sign(f) * P.fdead; return [P.Cx * d, uz]; } });
const HB_POS = [1.5, 1.0], HB_FORCE = [1.5, 1.0, 0.6, 1.5];
function thin(rolls, withForce) {
  const hb = withForce ? HB_FORCE : HB_POS, X = [], Y = [];
  for (const r of rolls) { let last = null; for (const s of r.tr) { const ob = withForce ? [s.z, s.d, s.fx, s.fz] : [s.z, s.d]; if (!last || ob.some((v, j) => Math.abs(v - last[j]) > 0.5 * hb[j])) { X.push(ob); Y.push(s.u); last = ob; } } }
  return { X, Y };
}
function learner(fr, withForce) {
  const hb = withForce ? HB_FORCE : HB_POS, d = hb.length, n = fr.X.length, X = new Float64Array(n * d), Y = new Float64Array(n * 2);
  for (let i = 0; i < n; i++) { for (let j = 0; j < d; j++) X[i * d + j] = fr.X[i][j]; Y[2 * i] = fr.Y[i][0]; Y[2 * i + 1] = fr.Y[i][1]; }
  return { K: P.K, act: (ob) => {
    const q = withForce ? [ob.z, ob.d, ob.fx, ob.fz] : [ob.z, ob.d]; let tot = 0, a0 = 0, a1 = 0, best = Infinity, bi = 0;
    for (let i = 0; i < n; i++) { let e = 0; for (let j = 0; j < d; j++) { const t = (X[i * d + j] - q[j]) / hb[j]; e += t * t; } if (e < best) { best = e; bi = i; } if (e <= 9) { const w = Math.exp(-0.5 * e); tot += w; a0 += w * Y[2 * i]; a1 += w * Y[2 * i + 1]; } }
    return tot < 1e-12 ? [Y[2 * bi], Y[2 * bi + 1]] : [a0 / tot, a1 / tot];
  } };
}
const CM = [1, 2, 3, 5, 10, 20, 40], CT = {}, CR = {};
for (const m of CM) {
  const rolls = evaluateC(() => yieldP(), m, 23, true).rolls, f = evaluateC(() => learner(thin(rolls, true), true), 200, 5), n = evaluateC(() => learner(thin(rolls, false), false), 200, 5);
  CT[m] = { f, n, ff: thin(rolls, true).X.length, nf: thin(rolls, false).X.length };
}
{ // the with-force curve is the ruler (the origin below its first point); the demonstrations without force are read off it, used alone
  const envC = { x: [0].concat(CM), y: [0] }; let mx = 0; for (const m of CM) { mx = Math.max(mx, CT[m].f.succ); envC.y.push(mx); }
  for (const m of CM) {
    const c = CT[m]; put('cf_' + m, c.f.succ * 100, 1); put('cfl_' + m, c.f.lo * 100, 1); put('cfh_' + m, c.f.hi * 100, 1); put('cn_' + m, c.n.succ * 100, 1); put('cnl_' + m, c.n.lo * 100, 1); put('cnh_' + m, c.n.hi * 100, 1);
    put('cff_' + m, c.ff, 0); put('cnf_' + m, c.nf, 0);
    const q = invert(envC, c.n.succ); CR[m] = { q, rho: q / m, lo: invert(envC, c.n.lo) / m, hi: invert(envC, c.n.hi) / m };
    put('cq_' + m, q, 4); put('cr_' + m, q / m, 6); put('crl_' + m, CR[m].lo, 6); put('crh_' + m, CR[m].hi, 6);
  }
  put('c_nomax', Math.max(...CM.map((m) => CT[m].n.succ)) * 100, 1); put('c_nomin', Math.min(...CM.map((m) => CT[m].n.succ)) * 100, 1); put('c_qmax', Math.max(...CM.map((m) => F['cq_' + m])), 2);
  put('c_cap', F.c_nomax / F.cf_1, 3); put('c_stiff', evaluateC(() => holdP(), 200, 5).succ * 100, 1);
  put('c_ratio_10_40', F.cn_40 === 0 ? 0 : F.cf_10 - F.cn_40, 1); put('c_nof_flat_lo', Math.min(...[2, 3, 5, 10, 20, 40].map((m) => CT[m].n.succ)) * 100, 1); put('c_nof_flat_hi', Math.max(...[2, 3, 5, 10, 20, 40].map((m) => CT[m].n.succ)) * 100, 1);
  put('c_sec_attempt', LG.TABLE.contact.secPerAttempt, 2);
}

/* ─────────────────────────── checks of the prose ─────────────────────────── */
// 1. the ledger, the independent path and the engine agree
{
  let worstS = 0, worstR = 0, nC = 0;
  for (const [key] of SRC) for (const na of BASES) MS.forEach((m) => { const i = [0, 4, 8, 16, 32, 64, 128, 256].indexOf(m), t = LG.TABLE.layouts.src[key]; const x = main.cell(key, na, m); worstS = Math.max(worstS, Math.abs(x.s - t.s[na][i])); worstR = Math.max(worstR, Math.abs(x.rho - t.rho[na][i])); if (x.kept !== t.kept[na][i]) fail(`kept differs from the ledger at ${key} ${na} ${m}: ${x.kept} vs ${t.kept[na][i]}`); nC++; });
  check(worstS < 1e-9, 'independent success equals the ledger at every cell (' + worstS + ')'); check(worstR < 6e-5, 'independent exchange rate equals the ledger at every cell to its rounding (' + worstR + ')');
  GRID.forEach((n, i) => { check(Math.abs(main.cur.hand[i] - LG.TABLE.layouts.ownHand.s[i]) < 1e-9 && Math.abs(main.cur.joint[i] - LG.TABLE.layouts.ownJoint.s[i]) < 1e-9, 'own curve equals the ledger at n = ' + n); });
  CM.forEach((m, i) => check(Math.abs(CT[m].f.succ - LG.TABLE.contact.withForce.s[i]) < 1e-9 && Math.abs(CT[m].n.succ - LG.TABLE.contact.noForce.s[i]) < 1e-9, 'contact cells equal the ledger at m = ' + m));
  check(Math.abs(LG.TABLE.contact.stiff.s * 100 - F.c_stiff) < 1e-9, 'the position policy of the ledger inserts ' + F.c_stiff + ' %');
  // the ledger's own inversion helper and the engine's agree with the bisection
  const cur = { N: GRID, s: main.cur.hand }, env = main.env.hand; let worst = 0;
  for (let s = 0.02; s < 0.995; s += 0.0137) worst = Math.max(worst, Math.abs(LG.ownEquivalent(cur, s) - invert(env, s)));
  check(worst < 1e-6, 'inversion by bisection equals the ledger\'s segment search (' + worst + ')');
  // the inversion is monotone and a round trip
  let prev = -1; for (let s = 0.01; s <= 0.99; s += 0.01) { const q = invert(env, s); check(q >= prev - 1e-9, 'N_eq is non-decreasing in S'); prev = q; if (s > 0.25 && s < 0.98) check(Math.abs(ownAt(env, q) - s) < 1e-9, 'ownAt(N_eq(S)) = S at S = ' + s); }
}
// 2. the entry: the same hours buy anything from less than nothing to everything
check(F.t_spread > 90, 'at the same attempted hours success spans more than 90 points (' + F.t_spread + ')');
check(F.t_s3 < F.t_own8 && F.t_tw > 97 && F.t_own256 > 98, 'the worst source leaves the policy below its eight own layouts; the twin matches 256 own layouts');
check(F.k_ol_8_256 < 256 && F.k_vd_8_256 < F.k_ol_8_256 && F.k_tw_8_256 === 256 && F.k_s3_8_256 === 256, 'the older arm and the footage lose attempts to discards, the twin and the simulators do not');
// 3. frames are hours in disguise: no help in separating the sources
check(F.fr_ratio_ol_64 > 90 && F.r_ol_8_64 < 0.5, 'the older arm stores more than 90 % of the twin\'s frames and is worth under half of the twin');
check(F.fr_gap_s01_s3_64 < 20 && F.r_s01_8_64 - F.r_s3_8_64 > 1, 'the 0.1 % and 3 % simulators store the same frames (within 20 of ~11,870) and differ by more than one in rate');
check(F.fr_per_demo_vd > F.fr_per_demo_tw, 'a footage demonstration holds more frames than a twin demonstration');
// 4. the unit: floor, interval, identity
for (const [key, , , c] of SRC) for (const na of BASES) for (const m of MS) {
  const x = main.cell(key, na, m), id = `${c}_${na}_${m}`;
  check(x.rho >= -na / m - 1e-9, `the rate is not below the floor -n/m at ${id}`);
  check(x.rlo <= x.rho + 1e-9 && x.rho <= x.rhi + 1e-9, `the interval contains the rate at ${id}`);
  check(Math.abs(x.rho * m - (x.neq - na)) < 1e-9, `rho m = N_eq - n at ${id}`);
}
check(Math.abs(F.r_s3_8_64 - (-8 / 64)) < 0.02, 'the 3 % simulator at 8 own + 64 attempted sits at the floor -n/m (' + F.r_s3_8_64 + ' vs -0.125)');
check(F.own_2 > F.own_4 + 10 && F.own_4 < F.own_8, 'the own curve dips at four layouts (' + F.own_2 + ' at 2, ' + F.own_4 + ' at 4)');
check(F.own_gain_64_128 > F.own_gain_128_256 * 2, 'the own curve saturates');
// 5. the draws: the twin is a control, the orderings hold on every draw
check(Math.abs(F.dm_tw_8_64 - 1) < 0.15 && Math.abs(F.dm_tw_32_64 - 1) < 0.2 && F.dl_tw_8_64 > 0.7 && F.dh_tw_8_64 < 1.4, 'the twin\'s rate averages about 1 over twelve draws (' + F.dm_tw_8_64 + ', ' + F.dm_tw_32_64 + ')');
check(Math.abs(F.dm_h3_8_64 - F.dm_tw_8_64) < 0.05 && Math.abs(F.dm_h3_32_64 - F.dm_tw_32_64) < 0.05, 'the 3 % simulator with hand labels is worth what the twin is worth');
for (const na of BASES) DR.forEach((r, d) => {
  const R = (k) => r.cells[`${k}|${na}|64`].rho;
  check(R('twin') > R('old') && R('old') > R('video'), `draw ${d}, ${na} own: twin > older arm > footage`);
  check(R('sim0.001') > R('sim0.003') && R('sim0.003') > R('sim0.01') && R('sim0.01') > R('sim0.03'), `draw ${d}, ${na} own: the simulators' rates fall with the gap`);
  check(R('sim0.03') < 0 && R('old') > 0, `draw ${d}, ${na} own: the 3 % simulator is harmful and the older arm is not`);
  check(R('simH0.03') > 0.7, `draw ${d}, ${na} own: hand labels rescue the 3 % simulator`);
});
check(F.dm_ol_8_64 > F.dm_ol_32_64 + 0.05 && F.dm_vd_8_64 > F.dm_vd_32_64 + 0.05 && F.dm_s1_8_64 > F.dm_s1_32_64 + 0.05, 'the rates of the older arm, the footage and the 1 % simulator are lower at 32 own layouts (draw means)');
check(F.dm_s3_32_64 < F.dm_s3_8_64 - 0.1, 'the 3 % simulator does more harm per layout when you hold more (draw means)');
check(Math.abs(F.dm_tw_32_64 - F.dm_tw_8_64) < 0.15 && Math.abs(F.dm_s01_32_64 - F.dm_s01_8_64) < 0.15, 'the twin\'s and the accurate simulator\'s rates do not move with the number of own layouts (draw means)');
check(F.r_ol_8_16 > F.r_ol_8_32 && F.r_ol_8_32 > F.r_ol_8_64 && F.r_ol_8_64 > F.r_ol_8_128 && F.r_ol_8_128 > F.r_ol_8_256, 'the older arm\'s rate falls with m at 8 own layouts');
check(F.dm_ol_8_16 > F.dm_ol_8_64 && F.dm_ol_8_64 > F.dm_ol_8_256, 'the older arm\'s rate falls with m over twelve draws');
check(F.r_vd_8_64 < F.r_ol_8_64 && F.r_vd_8_64 > 0, 'footage is worth less than the older arm and more than nothing at 64');
check(F.gain_tw_8 > 1.6 * F.gain_tw_32 && Math.abs(F.dm_tw_8_64 - F.dm_tw_32_64) < 0.15, 'the twin\'s success gain halves from 8 to 32 own layouts while its rate stays at one');
// 6. the contact block: a source that lacks a column
check(F.c_nomax < F.cf_1 - 10 && F.c_nomax < 70 && F.c_nomin > 50, 'demonstrations without force never reach what one demonstration with force gives (' + F.c_nomax + ' vs ' + F.cf_1 + ')');
check(F.cf_1 === F.cf_5 && F.cf_10 > 97 && F.cf_40 === F.cf_10, 'with force: one level from one to five demonstrations, another from ten');
check(F.c_qmax < 1, 'all the demonstrations without force together are worth less than one demonstration with force (' + F.c_qmax + ')');
check(Math.abs(CR[40].rho * 40 - CR[40].q) < 1e-9 && CR[40].rho < 0.03 && CR[1].rho > 0.5, 'the rate falls like 1/m');
check(Math.abs(F.c_stiff - F.c_nof_flat_hi) < 6 && F.c_nof_flat_hi - F.c_nof_flat_lo < 4, 'the clone without force is the position policy: flat from two demonstrations on');
// footage keeps improving with hours, the contact clone does not
check(F.s_vd_8_256 > F.s_vd_8_128 + 5 && F.s_vd_8_128 > F.s_vd_8_64 + 4, 'footage success is still rising at 256 attempted layouts');

/* ─────────────────────────── the checkpoint exercise, by hand ─────────────────────────── */
{ const c = { N: GRID, s: main.cur.hand }, e = main.env.hand, cur32 = main.cur.hand[7], cur48 = main.cur.hand[8], cur64 = main.cur.hand[9];
  const inv = (s) => invert(e, s);
  put('ck_neq_a', inv(0.62), 1); put('ck_rho_a', (inv(0.62) - 8) / 64, 2);
  put('ck_neq_b', inv(0.66), 1); put('ck_rho_b', (inv(0.66) - 32) / 64, 2);
  put('ck_neq_c', inv(0.12), 2); put('ck_rho_c', (inv(0.12) - 8) / 64, 3); put('ck_floor_c', -8 / 64, 3);
  // the ruler is flat from 2 to 8 layouts, so the eight alone (measured below the running maximum) do not read as eight: "no change" is not rho = 0 at n = 8
  put('ruler_8', ownAt(e, 8) * 100, 1); put('nochange_neq', inv(main.cur.hand[3]), 1); put('nochange_rho', (inv(main.cur.hand[3]) - 8) / 64, 2);
  check(ownAt(e, 2) === ownAt(e, 8) && main.cur.hand[3] < ownAt(e, 8) && inv(main.cur.hand[3]) < 1 && Math.abs(F.nochange_rho - F.r_s3_8_64) < 0.02, 'the ruler is flat from 2 to 8 layouts: a pooled success equal to the eight alone reads below one layout, next to the 3 % simulator');
  check(Math.abs(inv(ownAt(e, 8) + 1e-6) - 8) < 1e-3, 'the rate crosses zero just above the ruler value at n = 8 (' + F.ruler_8 + ' %)');
  put('ck_i1', cur32 * 100, 1); put('ck_i2', cur48 * 100, 1); put('ck_i3', cur64 * 100, 1);
  put('ck_m_own', (inv(0.62) - 8) * SEC / 60, 1); }

/* ─────────────────────────── the engine and the widget agree with all of this ─────────────────────────── */
{ // the engine's cells against the independent ones, through a vm-free require (node globals)
  globalThis.BN = BN; globalThis.LG = LG;
  const BL = require(path.join(root, dir, 'bodies_lab.js')); globalThis.BL = BL; globalThis.IL = IL;
  const EXp = path.join(root, dir, 'exchange_lab.js');
  if (fs.existsSync(EXp)) {
    const EX = require(EXp), eq = (a, b, m) => { if (Math.abs(a - b) > 1e-9) fail('engine vs independent: ' + m + ' ' + a + ' vs ' + b); };
    for (const [key, na, m] of [['old', 8, 64], ['twin', 32, 128], ['video', 8, 256], ['sim0.01', 32, 16], ['sim0.03', 8, 64], ['simH0.03', 8, 64], ['sim0.003', 8, 32]]) {
      const x = EX.cell(key, na, m), y = main.cell(key, na, m); eq(x.s, y.s, key + na + m + ' success'); eq(x.rho, y.rho, key + na + m + ' rho'); eq(x.rlo, y.rlo, key + na + m + ' rho low'); eq(x.rhi, y.rhi, key + na + m + ' rho high');
      eq(x.neq, y.neq, key + na + m + ' N_eq'); eq(x.kept, y.kept, key + na + m + ' kept'); eq(x.frames, y.frames, key + na + m + ' frames');
    }
    for (const c of ['s01', 's03', 's1', 's3']) { const key = SRC.find((s) => s[3] === c)[0]; eq(EX.gapCm(key), GAPRAW[c], 'label gap ' + c); }
    for (const m of CM) { const x = EX.contact(m), r = EX.contactRate(m); eq(x.f.s, CT[m].f.succ, 'contact with force ' + m); eq(x.n.s, CT[m].n.succ, 'contact without force ' + m); eq(r.rho, CR[m].rho, 'contact rate ' + m); eq(r.rlo, CR[m].lo, 'contact rate low ' + m); eq(r.rhi, CR[m].hi, 'contact rate high ' + m); }
  }
}
const html = path.join(root, dir, '01_exchange_rates.html');
if (fs.existsSync(html)) {
  const pg = loadPage(html);
  pg.problems.forEach((p) => fail('page problem: ' + p));
  const eqd = (id, want, digits, what) => { const got = pg.num(id); if (!(Math.abs(got - want) <= 0.5 * Math.pow(10, -digits) + 1e-9)) fail(`${what}: widget #${id} prints ${got}, independent computation gives ${want.toFixed(digits + 2)}`); };
  const rng2 = (id, lo, hi, digits, what) => { const t = pg.text(id).replace(/−/g, '-'), m = t.match(/-?\d+(?:\.\d+)?/g) || []; const a = +m[0], b = +m[1]; const tol = 0.5 * Math.pow(10, -digits) + 1e-9; if (!(Math.abs(a - lo) <= tol && Math.abs(b - hi) <= tol)) fail(`${what}: widget #${id} prints '${t}', independent computation gives ${lo.toFixed(digits + 2)} to ${hi.toFixed(digits + 2)}`); };
  const eqm = (want, digits, what) => { const t = pg.text('w01-m-v'), mm = t.match(/\(([\d.]+) min\)/), got = mm ? +mm[1] : NaN; if (!(Math.abs(got - want) <= 0.5 * Math.pow(10, -digits) + 1e-9)) fail(`${what}: widget #w01-m-v prints '${t}', independent computation gives ${want.toFixed(digits + 2)}`); };
  const OPT = ['twin', 'old', 'video', 'sim0.001', 'sim0.003', 'sim0.01', 'sim0.03', 'simH0.03'], MIDX = [0, 4, 8, 16, 32, 64, 128, 256];
  const state = (key, na, m) => { pg.set('w01-task', 'layouts'); pg.set('w01-src', key); pg.set('w01-base', na); pg.set('w01-m', MIDX.indexOf(m)); pg.drain(); };
  const probe = (key, na, m, tag) => {
    const x = main.cell(key, na, m), c = CODE[key], base = main.cur[SPACE[key]][GRID.indexOf(na)];
    state(key, na, m);
    eqd('w01-s', x.s * 100, 1, tag + ' success'); rng2('w01-sci', x.lo * 100, x.hi * 100, 1, tag + ' success interval'); eqd('w01-own', base * 100, 1, tag + ' own alone'); eqd('w01-neq', x.neq, 1, tag + ' own layouts with the same success');
    eqd('w01-rho', x.rho, 2, tag + ' exchange rate'); rng2('w01-rci', x.rlo, x.rhi, 2, tag + ' rate interval'); eqd('w01-kept', x.kept, 0, tag + ' kept'); eqd('w01-frames', x.frames, 0, tag + ' frames'); eqm(m * SEC / 60, 1, tag + ' minutes');
    if (SPACE[key] === 'joint') eqd('w01-gap', F['gap_' + c], 2, tag + ' label gap');
  };
  probe('old', 8, 64, 'default (older arm, 8 own, 64)');
  probe('old', 8, 16, 'older arm, 16'); probe('old', 8, 256, 'older arm, 256'); probe('old', 32, 64, 'older arm, 32 own');
  probe('twin', 8, 64, 'twin'); probe('twin', 8, 256, 'twin, 256'); probe('twin', 32, 64, 'twin, 32 own');
  probe('video', 8, 64, 'footage'); probe('video', 32, 64, 'footage, 32 own');
  for (const g of ['sim0.001', 'sim0.003', 'sim0.01', 'sim0.03', 'simH0.03']) probe(g, 8, 64, g);
  probe('sim0.03', 32, 64, 'sim0.03, 32 own'); probe('sim0.01', 8, 256, 'sim0.01, 256');
  state('old', 8, 0); eqd('w01-s', main.cur.hand[3] * 100, 1, 'no source hours: own alone');
  // the contact task
  pg.set('w01-task', 'contact');
  for (const m of [1, 5, 10, 40]) {
    pg.set('w01-m', CM.indexOf(m)); pg.drain(); const c = CT[m];
    eqd('w01-s', c.n.succ * 100, 1, `contact m=${m} success without force`); rng2('w01-sci', c.n.lo * 100, c.n.hi * 100, 1, `contact m=${m} interval`); eqd('w01-own', c.f.succ * 100, 1, `contact m=${m} success with force`);
    eqd('w01-neq', F['cq_' + m], 2, `contact m=${m} with-force demonstrations that match`); eqd('w01-rho', F['cr_' + m], 3, `contact m=${m} rate`); eqd('w01-frames', c.nf, 0, `contact m=${m} frames without force`);
  }
}

console.log(JSON.stringify({ facts: F }));
process.exit(bad ? 1 : 0);
