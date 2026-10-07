#!/usr/bin/env node
'use strict';
/* Oracle for synthetic_vision lesson 11 (what braking changes).
 *
 * It has its own implementation of the closed loop (own situation, own frames, own decision rule, kinematics by numerical integration AND by a closed form that is structured differently from the engine's),
 * and re-derives every quoted number from it:
 *   - the stopping distance, the deadlines, the regime table (speeds 5-8 m/s), the exact probability of each step-out stratum (quadrature of the scene law: a LAB PRIVILEGE, it reads SV.REAL.scene);
 *   - the engine l11_episode.js against the own implementation: outcomes of 300 random (situation, onset) pairs, and the decision frames of stored episodes recomputed from scratch (stratified, natural,
 *     street and human-log cells: anchors of l11_data.js);
 *   - the confounding toy by exact enumeration, and the human-driver logs: naive, stratified and true effects, positivity;
 *   - the intervention: both branches of every stratified situation (saved / caused / unchanged, impact speeds, price of a miss);
 *   - common random numbers: Var(X - Y) = Var X + Var Y - 2 Cov (Monte Carlo and bootstrap), correlation, variance ratio and episodes needed for three pairs;
 *   - the stopping margin against the exam over eleven detectors, a tied pair, the misses of consecutive frames against independence, the operating-point frontier;
 *   - the same detector in the program's world and the street's world (LAB PRIVILEGE: a project cannot run the street's closed loop);
 *   - the widget, driven through the states the prose names.
 * Last stdout line: {"facts": {...}}. */
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '../../../all_lessons');
const dir = fs.existsSync(path.join(root, 'synthetic_vision_new')) ? 'synthetic_vision_new' : 'synthetic_vision';
const SV = require(path.join(root, dir, 'street.js'));
require(path.join(root, dir, 'tables.js'));
require(path.join(root, dir, 'l06_rare.js'));
require(path.join(root, dir, 'l06_data.js'));
const L = require(path.join(root, dir, 'l11_episode.js'));
require(path.join(root, dir, 'l11_view.js'));
require(path.join(root, dir, 'l11_data.js'));
const T = SV.TABLES, D = SV.L11;
const { loadPage } = require('../dom_probe.js');
const T0 = Date.now();
let lapT = T0; const lap = (name) => { if (process.env.L11_TIME) { const n = Date.now(); console.error('lap ' + name + ' ' + ((n - lapT) / 1000).toFixed(1) + ' s'); lapT = n; } };

let bad = 0;
const fail = (m) => { bad++; console.error('FAIL ' + m); };
const check = (c, m) => { if (!c) fail(m); };
const F = {};
const put = (k, v, d) => { if (v !== v) return; F[k] = +(+v).toFixed(d === undefined ? 6 : d); };      // a NaN is not a fact: it is left out
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const variance = (a) => { const m = mean(a); return a.reduce((s, x) => s + (x - m) * (x - m), 0) / (a.length - 1); };
const covar = (a, b) => { const ma = mean(a), mb = mean(b); let s = 0; for (let i = 0; i < a.length; i++) s += (a[i] - ma) * (b[i] - mb); return s / (a.length - 1); };
const pc = (x) => 100 * x;
const near = (a, b, tol) => Math.abs(a - b) <= tol;

/* ───────── the lesson's stated assumptions (the page's table) ───────── */
const V0 = 7, ACC = 3, TAU = 0.4, HALF = 1.0, DT = 0.1, M_ALARM = 2, N_WIN = 3, TAU_H = 0.7, SEE = 6;
const U_PROG = 1.4, U_STREET = [0.6, 2.2];
check(L.SHUTTLE.v0 === V0 && L.SHUTTLE.a === ACC && L.SHUTTLE.tau === TAU && L.SHUTTLE.half === HALF && L.DT === DT && L.POLICY.m === M_ALARM && L.POLICY.n === N_WIN, 'the engine states the lesson\'s assumptions');
check(L.HUMAN.tau === TAU_H && L.HUMAN.see === SEE && L.PROGRAM_DYN.u[0] === U_PROG && L.STREET_DYN.u[0] === U_STREET[0] && L.STREET_DYN.u[1] === U_STREET[1], 'the engine states the human and walking-speed assumptions');
const PROG = SV.hybrid(SV.SIM0, SV.REAL, { scene: 'b', look: 'b', sensor: 'b', label: 'a' }), STREETP = SV.REAL;
const EDGES = [12, 16, 22];
const binOf = (z) => (z < EDGES[0] ? 0 : z < EDGES[1] ? 1 : z < EDGES[2] ? 2 : 3);

/* ───────── own kinematics ───────── */
const dStop = V0 * TAU + V0 * V0 / (2 * ACC);
/* closed form, by phases: coast to the onset, then brake; the front reaches the pedestrian's near surface zc or the shuttle stops short */
function outClosed(zc, x0, u, r, onset, v0 = V0, a = ACC) {
  const d1 = v0 * onset;
  if (zc <= d1) return fin(zc / v0, v0, x0, u, r);
  const rest = zc - d1, room = v0 * v0 / (2 * a);
  if (rest > room) return { stop: true, margin: rest - room, col: false, vImp: 0 };
  const vf = Math.sqrt(v0 * v0 - 2 * a * rest);
  return fin(onset + (v0 - vf) / a, vf, x0, u, r);
}
function fin(tf, v, x0, u, r) { const hit = Math.abs(x0 - u * tf) < HALF + r; return { stop: false, tf: tf, margin: null, col: hit, vImp: hit ? v : 0 }; }
/* numerical integration (forward Euler, 0.2 ms), a different method */
function outNum(zc, x0, u, r, onset, v0 = V0, a = ACC) {
  const h = 0.0002; let t = 0, s = 0, v = v0;
  for (;;) {
    if (s >= zc) { const hit = Math.abs(x0 - u * t) < HALF + r; return { stop: false, tf: t, col: hit, vImp: hit ? v : 0, margin: null }; }
    if (v <= 0) return { stop: true, margin: zc - s, col: false, vImp: 0 };
    if (t >= onset) v = Math.max(0, v - a * h);
    s += v * h; t += h;
  }
}

/* ───────── own situations, frames and decisions ───────── */
function sit(pipe, u, seed) {
  const sc = SV.drawScene(pipe.scene, SV.stream(seed, 'scene'), { ped: true, mode: 'emerge', vis: 0 }), look = SV.drawLook(pipe.look, sc, SV.stream(seed, 'look'));
  const uu = Array.isArray(u) ? u[0] + (u[1] - u[0]) * SV.stream(seed, 'dyn')() : u;
  return { pipe, sc, look, u: uu, x0: sc.ped.parts[0].x, z0: sc.ped.parts[0].z, r: sc.ped.parts[1].r, ped: sc.ped.id, seed };
}
function sitFast(u, seed) {                       // scene and speed only (no look): enough for outcomes
  const sc = SV.drawScene(PROG.scene, SV.stream(seed, 'scene'), { ped: true, mode: 'emerge', vis: 0 });
  const uu = Array.isArray(u) ? u[0] + (u[1] - u[0]) * SV.stream(seed, 'dyn')() : u;
  return { u: uu, x0: sc.ped.parts[0].x, z0: sc.ped.parts[0].z, r: sc.ped.parts[1].r };
}
function frameOf(S, k, v0 = V0) {
  const t = k * DT, s = v0 * t, parts = S.sc.parts.map((p) => Object.assign({}, p, { z: p.z - s, x: p.id === S.ped ? S.x0 - S.u * t : p.x }));
  const ren = SV.render({ insts: S.sc.insts, parts: parts }, S.look, { maps: true });
  let area = 0; for (let i = 0; i < ren.cov.length; i++) area += ren.cov[i];
  return { x: SV.sense(ren.rad, S.pipe.sensor, SV.stream(S.seed, 'sensor' + k)), area: area };
}
const lastFrame = (S, v0 = V0) => Math.floor((S.z0 - S.r) / v0 / DT);
function ownDecision(S, model, thr, m = M_ALARM, n = N_WIN) {          // the first frame with m alarms among the last n
  const al = [], sc = [];
  for (let k = 0; k <= lastFrame(S); k++) {
    sc.push(SV.score(model, frameOf(S, k).x).s); al.push(sc[k] > thr);
    let c = 0; for (let j = Math.max(0, k - n + 1); j <= k; j++) if (al[j]) c++;
    if (c >= m) return { kd: k, scores: sc };
  }
  return { kd: -1, scores: sc };
}
function firstSeen(S) { for (let k = 0; k <= lastFrame(S); k++) if (frameOf(S, k).area >= SEE) return k; return -1; }
const modelOf = (id) => { if (T.models['swap@' + id]) { const m = T.models['swap@' + id]; return { dim: 110, w: m.w, mu: m.mu, sd: m.sd, thr: m.thrReal }; } const m = SV.L06.models[id]; return { dim: 110, w: m.w, mu: m.mu, sd: m.sd, thr: m.thr }; };
const onsetOf = (kd) => (kd < 0 ? Infinity : kd * DT + TAU);
const marginOf = (S, kd) => (kd < 0 ? -dStop : S.z0 - S.r - V0 * kd * DT - dStop);

/* ═════════════ 1 · the stopping arithmetic and the regime ═════════════ */
put('dstop', dStop, 2); put('dstop_react', V0 * TAU, 2); put('dstop_brake', V0 * V0 / (2 * ACC), 2);
{ // the closed form against a numerical integration of the braking (onset 0.4 s, nobody in the way)
  let t = 0, s = 0, v = V0; const h = 0.0001; while (v > 0) { if (t >= TAU) v = Math.max(0, v - ACC * h); s += v * h; t += h; }
  check(near(s, dStop, 0.01), 'stopping distance by integration ' + s.toFixed(3) + ' vs closed form ' + dStop.toFixed(3));
  check(near(L.dStop(L.shuttle()), dStop, 1e-12), 'the engine\'s stopping distance');
}
for (const z of [10, 14, 18, 22, 26, 30]) { put('dl_' + z, (z - 0.25 - dStop) / V0, 2); put('arr_' + z, (z - 0.25) / V0, 2); }
check(F.dl_10 < 0 && F.dl_14 > 0 && F.dl_30 > 2, 'the deadlines: negative at 10 m, positive beyond the stopping distance');
{ // the kinematics: 300 random cases, engine against both own methods
  const rng = SV.rng(777); let worst = 0, nCol = 0, nStop = 0;
  const shh = L.shuttle();
  for (let i = 0; i < 300; i++) {
    const z0 = 8 + 22 * rng(), x0 = 1.8 + 2 * rng(), u = 0.6 + 1.6 * rng(), r = 0.2 + 0.08 * rng(), onset = rng() < 0.15 ? Infinity : 2.5 * rng();
    const zc = z0 - r, e = L.outcome({ z0: z0, x0: x0, u: u, r: r }, onset, shh), c = outClosed(zc, x0, u, r, onset), n = outNum(zc, x0, u, r, onset);
    if (c.col !== n.col && Math.abs(Math.abs(x0 - u * c.tf) - (HALF + r)) > 5e-3) fail('closed form vs numerical collision, case ' + i);
    check(e.collision === c.col && e.outcome === (c.stop ? 'stop' : c.col ? 'collision' : 'pass'), 'engine outcome vs own closed form, case ' + i);
    if (c.stop) { nStop++; worst = Math.max(worst, Math.abs(c.margin - n.margin)); check(near(e.margin, c.margin, 1e-9), 'margin, case ' + i); }
    if (c.col) { nCol++; worst = Math.max(worst, Math.abs(c.vImp - n.vImp)); check(near(e.vImpact, c.vImp, 1e-9), 'impact speed, case ' + i); }
  }
  check(worst < 0.02 && nCol > 20 && nStop > 20, 'closed form agrees with the numerical integration to ' + worst.toFixed(4) + ' m (m/s) over ' + nCol + ' collisions and ' + nStop + ' stops');
  // the engine's time/position inverses
  for (const tb of [0, 0.5, 1.3]) for (const s of [3, 9, 12.5]) { const t = L.timeAt(s, V0, ACC, tb); if (t < Infinity) check(near(L.travel(t, V0, ACC, tb), s, 1e-9), 'timeAt inverts travel'); }
}
/* exact probability of each stratum: z0 = z_van + hz + U(0.8, 9) (LAB PRIVILEGE: reads the street's scene law, the program's is identical for step-outs) */
const EXACT = (() => {
  const v = SV.REAL.scene.van, K = 1500; const cdf = (c) => { let acc = 0; for (let i = 0; i < K; i++) { const z = v.z[0] + (i + 0.5) / K * (v.z[1] - v.z[0]); for (let j = 0; j < K; j++) { const hz = v.hz[0] + (j + 0.5) / K * (v.hz[1] - v.hz[0]), q = (c - z - hz - 0.8) / 8.2; acc += q <= 0 ? 0 : q >= 1 ? 1 : q; } } return acc / (K * K); };
  const c = EDGES.map(cdf); return [c[0], c[1] - c[0], c[2] - c[1], 1 - c[2]];
})();
const W = EXACT;
EXACT.forEach((p, b) => { put('pbin_' + b, pc(p), 1); check(near(p, D.pbin[b], 4e-4), 'stratum ' + b + ': exact ' + p.toFixed(5) + ' vs builder\'s 10^6 draws ' + D.pbin[b]); });
put('pbin_R_one_in', 1 / W[0], 0);
{ // an independent Monte Carlo, different seeds
  const c = [0, 0, 0, 0], n = 150000; for (let i = 0; i < n; i++) c[binOf(sitFast(U_PROG, 31000000 + i).z0)]++;
  c.forEach((x, b) => check(near(x / n, W[b], 4 * Math.sqrt(W[b] * (1 - W[b]) / n)), 'stratum ' + b + ' by 150k own draws'));
}

lap('section 1 and exact strata');
/* ═════════════ the stratified sample, the natural pool, tabulated with the own outcome ═════════════ */
const SEEDS = [].concat(...D.strat.seeds), PER = D.strat.per, NS = SEEDS.length;
check(NS === 4 * PER, 'four strata of ' + PER + ' situations');
const SS = SEEDS.map((sd) => sitFast(U_PROG, sd)), SSt = SEEDS.map((sd) => sitFast(U_STREET, sd));
SS.forEach((s, i) => { if (binOf(s.z0) !== Math.floor(i / PER)) fail('situation ' + i + ' is not in its stratum'); });
const coastOf = (s) => outClosed(s.z0 - s.r, s.x0, s.u, s.r, Infinity);
const outc = (s, kd) => outClosed(s.z0 - s.r, s.x0, s.u, s.r, onsetOf(kd));
function table(S, kdArr) {                        // per stratum and overall (natural weights): collision rate, mean margin, detection rate, mean decision frame, mean impact speed
  const o = { col: [], mar: [], det: [], kd: [], vi: [], n: [] };
  for (let b = 0; b < 4; b++) {
    const idx = []; for (let i = b * PER; i < (b + 1) * PER; i++) idx.push(i);
    o.col.push(mean(idx.map((i) => +outc(S[i], kdArr[i]).col))); o.mar.push(mean(idx.map((i) => marginOf(S[i], kdArr[i])))); o.det.push(mean(idx.map((i) => +(kdArr[i] >= 0))));
    const dd = idx.filter((i) => kdArr[i] >= 0); o.kd.push(dd.length ? mean(dd.map((i) => kdArr[i])) : NaN); o.vi.push(mean(idx.map((i) => outc(S[i], kdArr[i]).vImp)));
  }
  const w = (a) => a.reduce((s, x, b) => s + W[b] * x, 0);
  o.colAll = w(o.col); o.marAll = w(o.mar); o.detAll = w(o.det); o.viAll = w(o.vi); return o;
}
const IDS = D.dets.concat(['ideal']);
const TAB = {}; IDS.forEach((id) => { TAB[id] = table(SS, D.strat.kd[id]); });
const TABS = {}; ['bbba', 'q25u', 'aaaa', 'ideal'].forEach((id) => { TABS[id] = table(SSt, D.street.kd[id]); });
const COAST = { col: [0, 1, 2, 3].map((b) => mean(SS.slice(b * PER, (b + 1) * PER).map((s) => +coastOf(s).col))), vi: [0, 1, 2, 3].map((b) => mean(SS.slice(b * PER, (b + 1) * PER).map((s) => coastOf(s).vImp))) };
COAST.colAll = COAST.col.reduce((s, x, b) => s + W[b] * x, 0); COAST.viAll = COAST.vi.reduce((s, x, b) => s + W[b] * x, 0);

lap('stratified sample tables');
/* ═════════════ anchors: stored decision frames recomputed from scratch with the own implementation ═════════════ */
{
  const cells = [['bbba', 3], ['bbba', 140], ['bbba', 260], ['bbba', 400], ['bbba', 520], ['bbba', 777], ['bbba', 990], ['aaaa', 20], ['aaaa', 600], ['q25u', 5], ['q25u', 330], ['abba', 150], ['abba', 800], ['baba', 150], ['baba', 800], ['q10u', 270], ['aaba', 910], ['bbaa', 40]];
  let n = 0; for (const [id, i] of cells) { const S = sit(PROG, U_PROG, SEEDS[i]), M = modelOf(id), r = ownDecision(S, M, M.thr); n++; check(r.kd === D.strat.kd[id][i], 'anchor ' + id + ' situation ' + i + ': own decision frame ' + r.kd + ' vs stored ' + D.strat.kd[id][i]); }
  for (const [id, i] of [['bbba', 100], ['bbba', 420], ['q25u', 700], ['aaaa', 900], ['bbba', 20]]) { const S = sit(STREETP, U_STREET, SEEDS[i]), M = modelOf(id), r = ownDecision(S, M, M.thr); n++; check(r.kd === D.street.kd[id][i], 'street anchor ' + id + ' situation ' + i + ': own ' + r.kd + ' vs stored ' + D.street.kd[id][i]); }
  for (const i of [11, 300, 520, 800, 950]) { const S = sit(PROG, U_PROG, SEEDS[i]); n++; check(firstSeen(S) === D.strat.kd.ideal[i], 'ideal anchor ' + i); }
  for (const [id, i] of [['bbba', 7], ['bbba', 640], ['q25u', 33], ['aaaa', 501]]) { const S = sit(PROG, U_PROG, D.nat.seeds[i]), M = modelOf(id), r = ownDecision(S, M, M.thr); n++; check(r.kd === D.nat.kd[id][i], 'natural-pool anchor ' + id + ' ' + i + ': own ' + r.kd + ' vs stored ' + D.nat.kd[id][i]); }
  put('anchors', n, 0);
}

lap('anchors');
/* ═════════════ 1 · what the closed loop says about the natural detector (the page's first table) ═════════════ */
{
  const t = TAB.bbba, ex = T.swap.bbba;
  put('ex_bbba', pc(ex.realMiss[0]), 1); put('emerge_bbba', pc(ex.missEmerge[0]), 1); put('open_bbba', pc(ex.missOpen[0]), 1);
  for (let b = 0; b < 4; b++) {
    put('dlmean_' + b, mean(SS.slice(b * PER, (b + 1) * PER).map((s) => (s.z0 - s.r - dStop) / V0)), 2);
    put('tdet_' + b, DT * t.kd[b], 2); put('col_nat_' + b, pc(t.col[b]), 1); put('mar_nat_' + b, t.mar[b], 1); put('det_nat_' + b, pc(t.det[b]), 0);
    put('coast_' + b, pc(COAST.col[b]), 1); put('vcoast_' + b, COAST.vi[b], 1); put('vnat_' + b, t.vi[b], 1);
    put('slack_' + b, F['dlmean_' + b] - F['tdet_' + b], 2);
  }
  put('col_nat', pc(t.colAll), 1); put('coast_all', pc(COAST.colAll), 1); put('det_nat', pc(t.detAll), 0); put('mar_nat', t.marAll, 1); put('vnat', t.viAll, 1); put('vcoast', COAST.viAll, 1);
  put('col_ideal', pc(TAB.ideal.colAll), 1); for (let b = 0; b < 4; b++) put('col_ideal_' + b, pc(TAB.ideal.col[b]), 1);
  for (let b = 0; b < 4; b++) put('room_' + b, pc(t.col[b] - TAB.ideal.col[b]), 1);
  { const tot = [0, 1, 2, 3].reduce((acc, b) => acc + W[b] * (t.col[b] - TAB.ideal.col[b]), 0); put('room_all', pc(tot), 1); for (let b = 0; b < 4; b++) put('room_share_' + b, 100 * W[b] * (t.col[b] - TAB.ideal.col[b]) / tot, 0); }
  check(F.coast_all > 20 && F.coast_all < 80, 'the regime: collisions without braking between 20% and 80% (' + F.coast_all + ')');
  check(F.col_nat_0 > 90 && F.col_nat_1 > 20 && F.col_nat_1 < 60 && F.col_nat_2 < 15 && F.col_nat_3 < 2, 'closed loop by stratum: the closest cannot be saved, the next marginal, the far easy');
  check(F.dlmean_0 < 0.05 && F.dlmean_1 > 0.3 && F.dlmean_3 > 1.5, 'the deadlines of the strata');
}
/* the regime table: four speeds, the first 400 natural situations */
for (const row of D.regime) {
  const v0 = row.v0, shh = L.shuttle({ v0: v0 }); let c = 0, p = 0; const dS = v0 * TAU + v0 * v0 / (2 * ACC);
  for (let i = 0; i < row.n; i++) {
    const s = sitFast(U_PROG, D.nat.seeds[i]), zc = s.z0 - s.r; c += +outClosed(zc, s.x0, s.u, s.r, Infinity, v0).col;
    p += +outClosed(zc, s.x0, s.u, s.r, row.kd[i] < 0 ? Infinity : row.kd[i] * DT + TAU, v0).col;
  }
  put('reg_dstop_' + v0, dS, 1); put('reg_coast_' + v0, pc(c / row.n), 1); put('reg_pol_' + v0, pc(p / row.n), 1);
  check(near(row.dStop, dS, 1e-9), 'regime stopping distance ' + v0);
}
{ const S = sit(PROG, U_PROG, D.nat.seeds[5]), shh = L.shuttle({ v0: 8 }); const S8 = Object.assign({}, S); const al = []; let kd = -1; for (let k = 0; k <= Math.floor((S.z0 - S.r) / 8 / DT); k++) { al.push(SV.score(modelOf('bbba'), frameOf(S, k, 8).x).s > modelOf('bbba').thr); let c = 0; for (let j = Math.max(0, k - 2); j <= k; j++) if (al[j]) c++; if (c >= 2) { kd = k; break; } } check(kd === D.regime[3].kd[5], 'regime anchor at 8 m/s: own decision frame ' + kd + ' vs stored ' + D.regime[3].kd[5]); }
check(F.reg_coast_5 < F.reg_coast_6 && F.reg_coast_6 < F.reg_coast_7 && F.reg_coast_7 < F.reg_coast_8 && F.reg_pol_7 < F.reg_coast_7, 'faster shuttle, more collisions without braking');

lap('closed loop table and regime');
/* ═════════════ the operating point: the frontier on the natural pool and on pedestrian-free approaches ═════════════ */
const NN = D.nat.seeds.length, NSIT = D.nat.seeds.map((sd) => sitFast(U_PROG, sd));
{
  const Fr = D.frontier, M = modelOf('bbba');
  // thresholds: the exam's rule on real validation negatives, own scoring
  const val = SV.real.val(1500), neg = val.filter((s) => !s.y).map((s) => SV.score(M, s.x).s).sort((a, b) => a - b);
  Fr.FA.forEach((fa, f) => { const thr = neg[Math.min(neg.length - 1, Math.floor((1 - fa) * neg.length))]; check(near(thr, Fr.thr[f], 1e-3 * Math.max(1, Math.abs(thr))), 'threshold at ' + fa + ' false alarms: own ' + thr.toFixed(4) + ' vs stored ' + Fr.thr[f]); });
  check(near(Fr.thr[2], M.thr, 1e-3), 'the exam\'s threshold is the 10% one');
  check(JSON.stringify(Fr.kd['2:2/3']) === JSON.stringify(D.nat.kd.bbba), 'the frontier\'s 10% two-of-three decisions equal the natural pool\'s stored decisions');
  const rows = [['2:1/1', '10% one alarm'], ['2:2/3', '10% two of three'], ['1:2/3', '3% two of three'], ['0:2/3', '1% two of three'], ['3:2/3', '30% two of three'], ['2:3/5', '10% three of five'], ['1:1/1', '3% one alarm']];
  for (const [key, name] of rows) {
    const kd = Fr.kd[key], f = +key.split(':')[0], k2 = key.replace(/[:\/]/g, '_');
    put('fr_col_' + k2, pc(mean(kd.map((k, i) => +outClosed(NSIT[i].z0 - NSIT[i].r, NSIT[i].x0, NSIT[i].u, NSIT[i].r, onsetOf(k)).col))), 1);
    put('fr_det_' + k2, pc(mean(kd.map((k) => +(k >= 0)))), 0); put('fr_early_' + k2, pc(mean(Fr.early[key])), 1);
    const fk = Fr.freeKd[key]; let expo = 0, ev = 0; for (const k of fk) { if (k >= 0) { ev++; expo += (k + 1) * DT; } else expo += L.NFREE * DT; }
    put('fr_false_' + k2, 60 * ev / expo, 1); put('fr_gap_' + k2, expo / ev, 0); put('fr_pfalse_' + k2, pc(ev / fk.length), 0); put('fr_thr_' + k2, Fr.thr[f], 2);
  }
  put('fr_nfree', Fr.nFree, 0); put('fr_secs', L.NFREE * DT, 1); put('fr_span', F.fr_col_2_3_5 - F.fr_col_2_1_1, 1);
  check(F.fr_col_2_2_3 < F.fr_col_1_2_3 && F.fr_col_1_2_3 < F.fr_col_0_2_3 && F.fr_false_2_2_3 > F.fr_false_1_2_3 && F.fr_false_1_2_3 > F.fr_false_0_2_3, 'the frontier: a stricter threshold collides more and brakes falsely less');
  check(F.fr_col_2_1_1 < F.fr_col_2_2_3 && F.fr_false_2_1_1 > F.fr_false_2_2_3, 'the debounce: waiting for a second alarm costs collisions and saves false brakes');
  // anchor: a few pedestrian-free approaches recomputed from scratch with the own frames
  for (const i of [3, 77, 150]) {
    const sc = SV.drawScene(PROG.scene, SV.stream(26000000 + i, 'scene'), { ped: false }), look = SV.drawLook(PROG.look, sc, SV.stream(26000000 + i, 'look')), al = []; let kd = -1;
    for (let k = 0; k < L.NFREE; k++) {
      const parts = sc.parts.map((p) => Object.assign({}, p, { z: p.z - V0 * k * DT })), ren = SV.render({ insts: sc.insts, parts: parts }, look, { maps: false });
      al.push(SV.score(M, SV.sense(ren.rad, PROG.sensor, SV.stream(26000000 + i, 'sensor' + k))).s > Fr.thr[2]); let c = 0; for (let j = Math.max(0, k - 2); j <= k; j++) if (al[j]) c++; if (c >= 2) { kd = k; break; }
    }
    check(kd === Fr.freeKd['2:2/3'][i], 'pedestrian-free approach ' + i + ': own ' + kd + ' vs stored ' + Fr.freeKd['2:2/3'][i]);
  }
  // the misses of consecutive frames (natural pool, frames in which the pedestrian counts, exam threshold)
  let n11 = 0, n10 = 0, n01 = 0, n00 = 0, miss = 0, tot = 0; const allMiss = [0, 0, 0, 0, 0, 0, 0], epK = [0, 0, 0, 0, 0, 0, 0], nep = [0, 0, 0, 0, 0, 0, 0];
  for (let i = 0; i < NN; i++) {
    if (Fr.k0[i] < 0) continue; const nb = Fr.bits[i] % 16, bm = Math.floor(Fr.bits[i] / 16), ms = []; for (let q = 0; q < nb; q++) ms.push((bm >> q) & 1);
    ms.forEach((m, q) => { tot++; miss += m; if (q + 1 < ms.length) { if (m && ms[q + 1]) n11++; else if (m) n10++; else if (ms[q + 1]) n01++; else n00++; } });
    for (let K = 1; K <= 6; K++) if (ms.length >= K) { nep[K]++; if (ms.slice(0, K).every((m) => m === 1)) epK[K]++; }
  }
  const pm = miss / tot; put('cm_frames', tot, 0); put('cm_miss', pc(pm), 1); put('cm_next_given_miss', pc(n11 / (n11 + n10)), 1); put('cm_next_given_hit', pc(n01 / (n01 + n00)), 1); put('cm_phi', n11 / (n11 + n10) - n01 / (n01 + n00), 2);
  for (let K = 1; K <= 5; K++) { put('cm_all_' + K, pc(epK[K] / nep[K]), 1); put('cm_ind_' + K, pc(Math.pow(pm, K)), 1); }
  put('cm_episodes', nep[1], 0);
  check(F.cm_next_given_miss > 2 * F.cm_miss * 0.9 && F.cm_all_3 > 1.5 * F.cm_ind_3, 'misses of consecutive frames are strongly correlated: far more runs of misses than independence predicts');
  // anchor: recompute the bit strings of 12 natural situations from scratch (full score sequence, areas)
  let ok = 0; for (const i of [2, 9, 31, 64, 120, 200, 333, 405, 512, 650, 777, 901]) {
    const S = sit(PROG, U_PROG, D.nat.seeds[i]); const fr = []; for (let k = 0; k <= lastFrame(S); k++) { const f = frameOf(S, k); fr.push({ s: SV.score(M, f.x).s, a: f.area }); }
    const c0 = fr.findIndex((f) => f.a >= SEE); let bm = 0, nb = 0; if (c0 >= 0) for (let k = c0; k < Math.min(fr.length, c0 + 12); k++) { if (fr[k].a >= SEE) { nb++; if (fr[k].s <= M.thr) bm |= (1 << (k - c0)); } else break; }
    check(c0 === Fr.k0[i] && bm * 16 + Math.min(nb, 12) === Fr.bits[i], 'miss bits of natural situation ' + i); ok++;
  }
  put('anchors_cm', ok, 0);
}

lap('frontier');
/* ═════════════ 2 · logs of human driving: the toy by exact enumeration, then the lab's logs ═════════════ */
{
  const share = { near: 0.3, far: 0.7 }, pb = { near: 0.9, far: 0.2 }, pcb = { near: 0.5, far: 0.02 }, pcn = { near: 0.9, far: 0.1 };
  let nb = 0, cb = 0, nn = 0, cn = 0; const cell = {};
  for (const s of ['near', 'far']) for (const braked of [true, false]) {
    const p = share[s] * (braked ? pb[s] : 1 - pb[s]), c = braked ? pcb[s] : pcn[s];
    if (braked) { nb += p; cb += p * c; } else { nn += p; cn += p * c; }
  }
  put('toy_braked', pc(cb / nb), 1); put('toy_unbraked', pc(cn / nn), 1); put('toy_naive', pc(cb / nb - cn / nn), 1);
  put('toy_near', pc(pcb.near - pcn.near), 0); put('toy_far', pc(pcb.far - pcn.far), 0); put('toy_truth', pc(share.near * (pcb.near - pcn.near) + share.far * (pcb.far - pcn.far)), 1);
  put('toy_share_braked', pc(nb), 0);
  check(cb / nb > cn / nn && pcb.near < pcn.near && pcb.far < pcn.far && F.toy_truth < 0, 'the toy: braking looks harmful pooled and helps in every stratum');
}
const LG = D.logs, NL = LG.n;
{ // anchors: first frame with 6 px^2 and who braked, from scratch
  const rngA = [0, 5, 77, 180, 400, 1234, 2500, 3999]; let ok = 0;
  for (const i of rngA) {
    const sd = LG.seed0 + i, S = sit(PROG, U_PROG, sd), ks = firstSeen(S);
    const full = (() => { const r = SV.render(S.sc, S.look, { only: 'ped', maps: true }); let a = 0; for (const c of r.cov) a += c; return a; })();
    const A = 6 + (27 - 6) * SV.stream(sd, 'driver')(), braked = A <= full ? 1 : 0;
    check(ks === LG.ks[i] && braked === LG.braked[i], 'log anchor ' + i + ': own ' + ks + '/' + braked + ' vs stored ' + LG.ks[i] + '/' + LG.braked[i]); ok++;
  }
  put('anchors_logs', ok, 0);
}
{
  const S = []; for (let i = 0; i < NL; i++) S.push(sitFast(U_PROG, LG.seed0 + i));
  const rows = S.map((s, i) => {
    const zc = s.z0 - s.r, onB = LG.ks[i] >= 0 ? LG.ks[i] * DT + TAU_H : Infinity, ob = LG.braked[i] ? outClosed(zc, s.x0, s.u, s.r, onB) : outClosed(zc, s.x0, s.u, s.r, Infinity);
    return { b: binOf(s.z0), braked: LG.braked[i], col: +ob.col, vi: ob.vImp, c0: +outClosed(zc, s.x0, s.u, s.r, Infinity).col, v0c: outClosed(zc, s.x0, s.u, s.r, Infinity).vImp, c1: +outClosed(zc, s.x0, s.u, s.r, onB).col, v1: outClosed(zc, s.x0, s.u, s.r, onB).vImp };
  });
  const br = rows.filter((r) => r.braked), nb = rows.filter((r) => !r.braked);
  put('log_n', NL, 0); put('log_braked_share', pc(br.length / NL), 0); put('log_naive_braked', pc(mean(br.map((r) => r.col))), 1); put('log_naive_unbraked', pc(mean(nb.map((r) => r.col))), 1);
  put('log_naive', pc(mean(br.map((r) => r.col)) - mean(nb.map((r) => r.col))), 1);
  put('log_truth', pc(mean(rows.map((r) => r.c1)) - mean(rows.map((r) => r.c0))), 1);
  let saved = 0, caused = 0; rows.forEach((r) => { if (!r.c1 && r.c0) saved++; if (r.c1 && !r.c0) caused++; });
  put('log_saved', saved, 0); put('log_caused', caused, 0); put('log_saved_pct', pc(saved / NL), 1); put('log_caused_pct', pc(caused / NL), 1);
  const strat = []; for (let b = 0; b < 4; b++) {
    const x = rows.filter((r) => r.b === b), xb = x.filter((r) => r.braked), xn = x.filter((r) => !r.braked);
    put('log_n_' + b, x.length, 0); put('log_braked_' + b, pc(xb.length / x.length), 0); put('log_colB_' + b, xb.length ? pc(mean(xb.map((r) => r.col))) : NaN, 0);
    put('log_colN_' + b, xn.length ? pc(mean(xn.map((r) => r.col))) : NaN, 0); put('log_est_' + b, xn.length && xb.length ? pc(mean(xb.map((r) => r.col)) - mean(xn.map((r) => r.col))) : NaN, 0);
    put('log_truth_' + b, pc(mean(x.map((r) => r.c1)) - mean(x.map((r) => r.c0))), 0);
    put('log_vB_' + b, mean(x.map((r) => r.v1)), 1); put('log_vC_' + b, mean(x.map((r) => r.v0c)), 1);
    strat.push({ w: x.length / NL, est: xn.length && xb.length ? mean(xb.map((r) => r.col)) - mean(xn.map((r) => r.col)) : null, truth: mean(x.map((r) => r.c1)) - mean(x.map((r) => r.c0)) });
  }
  // the stratified estimate where both kinds exist, weighted by the strata's shares, and the truth over the same strata
  const ok = strat.filter((s) => s.est !== null), wsum = ok.reduce((s, x) => s + x.w, 0);
  put('log_strat_overlap', pc(ok.reduce((s, x) => s + x.w * x.est, 0) / wsum), 1); put('log_truth_overlap', pc(ok.reduce((s, x) => s + x.w * x.truth, 0) / wsum), 1); put('log_overlap_share', pc(wsum), 0);
  put('log_far_braked_pct', F.log_braked_3, 0); put('log_factor', F.log_truth / F.log_naive, 1);
  check(F.log_braked_0 === 100 && F.log_n_0 > 100, 'positivity fails for the closest step-outs: every driver brakes (' + F.log_braked_0 + '% of ' + F.log_n_0 + ')');
  check(F.log_naive < 0 && Math.abs(F.log_naive) < 0.4 * Math.abs(F.log_truth) && F.log_truth < -30, 'the naive contrast understates the effect by more than half');
  check([1, 2, 3].every((b) => F['log_est_' + b] < 0 && Math.abs(F['log_est_' + b] - F['log_truth_' + b]) < 12), 'the stratified estimate is close to the truth where both kinds of episode exist');
  check(F.log_truth_0 > 0 && F.log_caused > 0, 'braking caused some collisions in the closest stratum');
}

lap('human logs');
/* ═════════════ 3 · the intervention: both branches of the stratified situations, natural detector ═════════════ */
{
  const kd = D.strat.kd.bbba; let tot = [0, 0, 0];
  for (let b = 0; b < 4; b++) {
    let sv = 0, cs = 0, sm = 0, vb = 0, vc = 0, nStop = 0; const idx = []; for (let i = b * PER; i < (b + 1) * PER; i++) idx.push(i);
    for (const i of idx) { const o = outc(SS[i], kd[i]), c = coastOf(SS[i]); if (c.col && !o.col) sv++; else if (!c.col && o.col) cs++; else sm++; if (o.stop) nStop++; vb += o.vImp; vc += c.vImp; }
    put('sv_' + b, pc(sv / PER), 1); put('cs_' + b, pc(cs / PER), 1); put('sm_' + b, pc(sm / PER), 1); put('stop_' + b, pc(nStop / PER), 0);
    put('eff_' + b, pc(TAB.bbba.col[b] - COAST.col[b]), 1);
    tot[0] += W[b] * sv / PER; tot[1] += W[b] * cs / PER; tot[2] += W[b] * sm / PER;
  }
  put('sv_all', pc(tot[0]), 1); put('cs_all', pc(tot[1]), 1); put('sm_all', pc(tot[2]), 1); put('eff_all', pc(TAB.bbba.colAll - COAST.colAll), 1);
  put('vcut_0', pc(1 - F.vnat_0 / F.vcoast_0), 0);
  { // severity proxy: kinetic energy at impact per kilogram, v^2/2, per band; what the policy buys per step-out, in collisions and in energy; case R against the others (Lesson 6's c)
    const en0 = [], en1 = [];
    for (let b = 0; b < 4; b++) { let a0 = 0, a1 = 0; for (let i = b * PER; i < (b + 1) * PER; i++) { const v0_ = coastOf(SS[i]).vImp, v1_ = outc(SS[i], kd[i]).vImp; a0 += v0_ * v0_ / 2; a1 += v1_ * v1_ / 2; } en0.push(a0 / PER); en1.push(a1 / PER); put('en_coast_' + b, en0[b], 1); put('en_pol_' + b, en1[b], 1); }
    put('ecut_0', pc(1 - en1[0] / en0[0]), 0);
    const pC = [0, 1, 2, 3].map((b) => COAST.col[b] - TAB.bbba.col[b]), pE = [0, 1, 2, 3].map((b) => en0[b] - en1[b]), wo = W[1] + W[2] + W[3];
    const eC = (W[1] * pC[1] + W[2] * pC[2] + W[3] * pC[3]) / wo, eE = (W[1] * pE[1] + W[2] * pE[2] + W[3] * pE[3]) / wo;
    put('price_els_col', eC, 2); put('price_en_0', pE[0], 0); put('price_els_en', eE, 0); put('c_col', pC[0] / eC, 1); put('c_en', pE[0] / eE, 1);
  }
  check(F.sv_1 > 40 && F.sv_2 > 40 && F.sv_0 < 5 && F.eff_3 > -10, 'braking saves most in the middle strata, almost nothing in the closest');
  // the price of a miss: collisions avoided per step-out the detector decides in time, stratum by stratum (the closed-loop weights of Lesson 6's exam)
  for (let b = 0; b < 4; b++) put('price_' + b, -F['eff_' + b] / 100, 2);
  // determinism and branch consistency of the engine
  const sd = SEEDS[300], world = L.programWorld('bbba'), m = modelOf('bbba'), pol = { thr: m.thr, m: 2, n: 3 };
  const e1 = L.episode(world, m, pol, sd), e2 = L.episode(world, m, pol, sd, { sit: L.situation(world, sd, L.shuttle()) });
  check(e1.kDecide === e2.kDecide && e1.collision === e2.collision && e1.margin === e2.margin, 'an episode is a function of its seed');
  check(JSON.stringify(e1.scores) === JSON.stringify(e2.scores), 'frames and scores are reproduced bit for bit');
  const never = L.episode(world, m, { thr: Infinity, m: 2, n: 3 }, sd);
  check(never.kDecide === -1 && never.collision === L.branch(e1, 'coast').collision && never.vImpact === L.branch(e1, 'coast').vImpact, 'the coast branch of an episode is the episode of a policy that never decides');
  check(L.branch(e1, 'brake').collision === e1.collision, 'the brake branch is the episode');
  const full = L.episode(world, m, pol, sd, { full: true }); check(full.kDecide === e1.kDecide && full.scores.length >= e1.scores.length && full.scores.slice(0, e1.scores.length).join() === e1.scores.join(), 'scoring past the decision does not change it');
}

lap('intervention');
/* ═════════════ 4 · common random numbers ═════════════ */
const POOL = { coast: NSIT.map((s) => +coastOf(s).col) };
['bbba', 'q25u', 'aaaa'].forEach((id) => { POOL[id] = NSIT.map((s, i) => +outc(s, D.nat.kd[id][i]).col); });
const PAIR = { act: ['bbba', 'coast'], det: ['bbba', 'q25u'], naive: ['bbba', 'aaaa'] };
put('nat_se', pc(Math.sqrt(mean(POOL.bbba) * (1 - mean(POOL.bbba)) / NN)), 1);          // one standard error of a collision rate read from the 1,000 natural situations
function pairStats(a, b) {
  const va = variance(a), vb = variance(b), cv = covar(a, b), rho = cv / Math.sqrt(va * vb);
  return { va, vb, cv, rho, k: (va + vb) / (va + vb - 2 * cv), d: mean(a) - mean(b) };
}
const need = (v, delta) => 1.96 * 1.96 * v / (delta * delta);
for (const key of Object.keys(PAIR)) {
  const [A, B] = PAIR[key], s = pairStats(POOL[A], POOL[B]);
  put('crn_rho_' + key, s.rho, 2); put('crn_k_' + key, s.k, 1); put('crn_d_' + key, pc(s.d), 1); put('crn_pa_' + key, pc(mean(POOL[A])), 1); put('crn_pb_' + key, pc(mean(POOL[B])), 1);
  put('crn_vind_' + key, s.va + s.vb, 3); put('crn_vcrn_' + key, s.va + s.vb - 2 * s.cv, 3);
  const delta = key === 'act' ? 0.1 : 0.02;
  put('crn_delta_' + key, pc(delta), 0); put('crn_n_ind_' + key, need(s.va + s.vb, delta), 0); put('crn_n_crn_' + key, need(s.va + s.vb - 2 * s.cv, delta), 0);
  const disc = POOL[A].reduce((c, x, i) => c + (x !== POOL[B][i] ? 1 : 0), 0); put('crn_discord_' + key, pc(disc / NN), 1);
}
check(F.crn_k_det > 4 && F.crn_k_act > 1.2 && F.crn_k_naive >= 1 && F.crn_k_det > F.crn_k_naive, 'sharing helps most when the two arms are alike (' + [F.crn_k_act, F.crn_k_det, F.crn_k_naive] + ')');
{ // the identity and the resampling spread (the widget's computation, re-implemented): shared and independent estimates of 20 situations
  const rs = {};
  for (const key of Object.keys(PAIR)) {
    const a = POOL[PAIR[key][0]], b = POOL[PAIR[key][1]], dS = [], dI = [];
    for (let r = 0; r < 400; r++) {
      const rng = SV.rng(1000 + r), idx = Array.from({ length: NN }, (_, i) => i);
      for (let i = NN - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
      const f = idx.slice(0, 20), g = idx.slice(20, 40);
      dS.push(mean(f.map((i) => a[i] - b[i]))); dI.push(mean(f.map((i) => a[i])) - mean(g.map((i) => b[i])));
    }
    const sdS = Math.sqrt(variance(dS)), sdI = Math.sqrt(variance(dI)), s = pairStats(a, b), fpc = 1 - 20 / NN;
    rs[key] = { sdS, sdI, ratio: sdI * sdI / (sdS * sdS) };
    put('rs_sdS_' + key, pc(sdS), 1); put('rs_sdI_' + key, pc(sdI), 1); put('rs_ratio_' + key, rs[key].ratio, 1);
    // Var(X - Y) = Var X + Var Y - 2 Cov: predicted spread of 20 shared pairs, and of 20 + 20 independent ones
    check(near(sdS, Math.sqrt((s.va + s.vb - 2 * s.cv) / 20 * fpc), 0.2 * sdS + 0.004), key + ': the spread of the shared estimate follows Var X + Var Y - 2 Cov (' + sdS.toFixed(4) + ' vs ' + Math.sqrt((s.va + s.vb - 2 * s.cv) / 20 * fpc).toFixed(4) + ')');
    check(near(sdI, Math.sqrt((s.va + s.vb) / 20 * fpc), 0.2 * sdI + 0.004), key + ': the spread of the independent estimate follows Var X + Var Y');
  }
  check(rs.det.ratio > 2 * rs.naive.ratio || rs.det.ratio > 4, 'the resampled variance ratio is larger for twins');
  // bootstrap over situations: the variance ratio of the paired and of the unpaired estimate of the same difference
  const rng = SV.rng(4242); const a = POOL.bbba, b = POOL.q25u, dp = [], du = [];
  for (let r = 0; r < 600; r++) { let sp = 0, sa = 0, sb = 0; for (let i = 0; i < NN; i++) { const j = Math.floor(rng() * NN); sp += a[j] - b[j]; sa += a[j]; } for (let i = 0; i < NN; i++) sb += b[Math.floor(rng() * NN)]; dp.push(sp / NN); du.push((sa - sb) / NN); }
  put('boot_k_det', variance(du) / variance(dp), 1); check(near(F.boot_k_det, F.crn_k_det, 0.3 * F.crn_k_det), 'bootstrap variance ratio ' + F.boot_k_det + ' vs analytic ' + F.crn_k_det);
}

lap('crn');
/* ═════════════ 5 · the stopping margin against the exam ═════════════ */
{
  const rows = IDS.filter((id) => id !== 'ideal').map((id) => {
    const ex = T.swap[id] ? T.swap[id].realMiss[0] : SV.L06.arms[id].exam[0], t = TAB[id];
    return { id, ex: ex, col: t.colAll, mar: t.marAll, det: t.detAll, early: 0 };
  });
  rows.forEach((r) => { put('tb_ex_' + r.id, pc(r.ex), 1); put('tb_col_' + r.id, pc(r.col), 1); put('tb_mar_' + r.id, r.mar, 1); put('tb_det_' + r.id, pc(r.det), 0); });
  const ranks = (a) => { const idx = a.map((v, i) => [v, i]).sort((x, y) => x[0] - y[0]), r = new Array(a.length); let i = 0; while (i < idx.length) { let j = i; while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++; const avg = (i + j) / 2 + 1; for (let k = i; k <= j; k++) r[idx[k][1]] = avg; i = j + 1; } return r; };
  const pear = (a, b) => covar(a, b) / Math.sqrt(variance(a) * variance(b)), spear = (a, b) => pear(ranks(a), ranks(b));
  const col = rows.map((r) => r.col);
  put('rho_exam', pear(rows.map((r) => r.ex), col), 2); put('rho_margin', pear(rows.map((r) => r.mar), col), 2); put('rho_det', pear(rows.map((r) => r.det), col), 2);
  put('sp_exam', spear(rows.map((r) => r.ex), col), 2); put('sp_margin', spear(rows.map((r) => r.mar), col), 2); put('sp_det', spear(rows.map((r) => r.det), col), 2);
  put('tb_n', rows.length, 0);
  // the tied pair: abba against baba, same situations; stratified standard error of the paired and of the unpaired difference
  const diffStats = (A, B, f) => {
    let v1 = 0, v0 = 0, d = 0;
    for (let b = 0; b < 4; b++) {
      const x = [], y = []; for (let i = b * PER; i < (b + 1) * PER; i++) { x.push(f(A, i)); y.push(f(B, i)); }
      const dd = x.map((v, i) => v - y[i]); d += W[b] * mean(dd); v1 += W[b] * W[b] * variance(dd) / PER; v0 += W[b] * W[b] * (variance(x) + variance(y)) / PER;
    }
    return { d: d, se1: Math.sqrt(v1), se0: Math.sqrt(v0), k: v0 / v1 };
  };
  const colF = (id, i) => +outc(SS[i], D.strat.kd[id][i]).col, marF = (id, i) => marginOf(SS[i], D.strat.kd[id][i]), detF = (id, i) => +(D.strat.kd[id][i] >= 0);
  const pr = diffStats('baba', 'abba', colF), pm = diffStats('abba', 'baba', marF), pd = diffStats('abba', 'baba', detF);
  put('pair_exam_diff', pc(T.swap.abba.realMiss[0] - T.swap.baba.realMiss[0]), 1); put('pair_exam_abba', pc(T.swap.abba.realMiss[0]), 1); put('pair_exam_baba', pc(T.swap.baba.realMiss[0]), 1);
  put('pair_exam_3seed_abba', pc(mean(T.swap.abba.realMiss)), 1); put('pair_exam_3seed_baba', pc(mean(T.swap.baba.realMiss)), 1);
  put('pair_col_diff', pc(pr.d), 1); put('pair_col_se', pc(pr.se1), 1); put('pair_col_se_indep', pc(pr.se0), 1); put('pair_col_k', pr.k, 1);
  put('pair_mar_diff', pm.d, 2); put('pair_mar_se', pm.se1, 2); put('pair_det_diff', pc(pd.d), 1); put('pair_det_se', pc(pd.se1), 1); put('pair_col_z', pr.d / pr.se1, 1); put('pair_col_z_indep', pr.d / pr.se0, 1);
  put('pair_col_abba', pc(TAB.abba.colAll), 1); put('pair_col_baba', pc(TAB.baba.colAll), 1); put('pair_mar_abba', TAB.abba.marAll, 2); put('pair_mar_baba', TAB.baba.marAll, 2);
  // Lesson 6's detectors: the exam charges the oversampled ones, the loop does not
  const q25 = diffStats('q25u', 'bbba', colF), q10 = diffStats('q10u', 'bbba', colF), q50 = diffStats('q50u', 'bbba', colF);
  put('ex_q10u', pc(SV.L06.arms.q10u.exam[0]), 1); put('ex_q25u', pc(SV.L06.arms.q25u.exam[0]), 1); put('ex_q50u', pc(SV.L06.arms.q50u.exam[0]), 1); put('ex_nat6', pc(SV.L06.arms.nat.exam[0]), 1);
  put('exd_q10u', pc(SV.L06.arms.q10u.exam[0] - SV.L06.arms.nat.exam[0]), 1); put('exd_q25u', pc(SV.L06.arms.q25u.exam[0] - SV.L06.arms.nat.exam[0]), 1); put('exd_q50u', pc(SV.L06.arms.q50u.exam[0] - SV.L06.arms.nat.exam[0]), 1);
  put('col_q25u', pc(TAB.q25u.colAll), 1); put('col_q10u', pc(TAB.q10u.colAll), 1); put('col_q50u', pc(TAB.q50u.colAll), 1);
  put('cd_q25u', pc(q25.d), 1); put('cd_q25u_se', pc(q25.se1), 1); put('cd_q25u_se_indep', pc(q25.se0), 1); put('cd_q50u', pc(q50.d), 1); put('cd_q50u_se', pc(q50.se1), 1); put('cd_q10u', pc(q10.d), 1);
  put('md_q25u', TAB.q25u.marAll - TAB.bbba.marAll, 2); put('md_q50u', TAB.q50u.marAll - TAB.bbba.marAll, 2);
  { const m25 = diffStats('q25u', 'bbba', marF), m50 = diffStats('q50u', 'bbba', marF), m10 = diffStats('q10u', 'bbba', marF);          // the same paired comparison on the margin
    put('mse_q25u', m25.se1, 2); put('mse_q50u', m50.se1, 2); put('mz_q25u', m25.d / m25.se1, 1); put('mz_q50u', m50.d / m50.se1, 1); put('mz_q10u', m10.d / m10.se1, 1);
    put('cz_q25u', q25.d / q25.se1, 1); put('cz_q50u', q50.d / q50.se1, 1); put('cz_q10u', q10.d / q10.se1, 1); put('cse_q10u', pc(q10.se1), 1); }
  for (let b = 0; b < 2; b++) { put('col_q25u_' + b, pc(TAB.q25u.col[b]), 1); put('mar_q25u_' + b, TAB.q25u.mar[b], 1); put('tdet_q25u_' + b, DT * TAB.q25u.kd[b], 2); }
  put('tdet_aaaa_1', DT * TAB.aaaa.kd[1], 2); put('col_aaaa', pc(TAB.aaaa.colAll), 1); put('det_aaaa', pc(TAB.aaaa.detAll), 0); put('mar_aaaa', TAB.aaaa.marAll, 1);
  put('ex_aaaa', pc(T.swap.aaaa.realMiss[0]), 1); put('emerge_aaaa', pc(T.swap.aaaa.missEmerge[0]), 1);
  put('crn_k_pair_abba', pr.k, 1);
  { const a1 = diffStats('abba', 'q50u', colF), a2 = diffStats('abba', 'q50u', marF), a3 = diffStats('abba', 'q50u', detF);
    put('ab_col_d', pc(a1.d), 1); put('ab_col_se', pc(a1.se1), 1); put('ab_col_z', a1.d / a1.se1, 1); put('ab_mar_d', a2.d, 2); put('ab_mar_se', a2.se1, 2); put('ab_mar_z', a2.d / a2.se1, 1); put('ab_det_d', pc(a3.d), 1); put('ab_det_se', pc(a3.se1), 1); put('ab_det_z', a3.d / a3.se1, 1); }
  // the per-frame/per-episode contrast: frames of step-outs in which the pedestrian counts, the share the detector misses vs the share of episodes it decides in time
  put('ideal_det_share', pc(TAB.ideal.detAll), 0);
  check(F.rho_margin < -0.9 && F.rho_exam > 0.9 && F.sp_exam > 0.9, 'across eleven detectors the margin and the exam both rank the closed loop');
}

lap('margin vs exam');
/* ═════════════ 6 · the same detector in two worlds ═════════════ */
{
  const WP = D.worlds.per, WS = [].concat(...D.worlds.seeds), NW = WS.length, idxOf = (b) => Array.from({ length: WP }, (_, i) => b * WP + i);
  check(NW === 4 * WP, 'four strata of ' + WP + ' situations in the worlds sample');
  for (let b = 0; b < 4; b++) for (let i = 0; i < PER; i += 41) {
    check(D.worlds.seeds[b][i] === D.strat.seeds[b][i], 'the worlds sample extends the stratified one');
    check(D.worlds.kd.prog[b * WP + i] === D.strat.kd.bbba[b * PER + i], 'worlds (program) agrees with the stratified decisions');
    check(D.worlds.kd.street[b * WP + i] === D.street.kd.bbba[b * PER + i], 'worlds (street) agrees with the street job');
  }
  const SW = WS.map((sd) => sitFast(U_PROG, sd)), SWt = WS.map((sd) => sitFast(U_STREET, sd));
  SW.forEach((s, i) => { if (binOf(s.z0) !== Math.floor(i / WP)) fail('worlds situation ' + i + ' is not in its stratum'); });
  const cP = SW.map((s, i) => +outClosed(s.z0 - s.r, s.x0, s.u, s.r, onsetOf(D.worlds.kd.prog[i])).col), cS = SWt.map((s, i) => +outClosed(s.z0 - s.r, s.x0, s.u, s.r, onsetOf(D.worlds.kd.street[i])).col);
  const kP = SW.map((s) => +coastOf(s).col), kS = SWt.map((s) => +coastOf(s).col), vP = SW.map((s, i) => outClosed(s.z0 - s.r, s.x0, s.u, s.r, onsetOf(D.worlds.kd.prog[i])).vImp), vS = SWt.map((s, i) => outClosed(s.z0 - s.r, s.x0, s.u, s.r, onsetOf(D.worlds.kd.street[i])).vImp);
  let d = 0, v1 = 0, v0 = 0, pP = 0, pS = 0, qP = 0, qS = 0;
  for (let b = 0; b < 4; b++) {
    const ix = idxOf(b), a = ix.map((i) => cP[i]), c = ix.map((i) => cS[i]), dd = c.map((x, i) => x - a[i]);
    put('w_prog_' + b, pc(mean(a)), 1); put('w_street_' + b, pc(mean(c)), 1); put('w_diff_' + b, pc(mean(dd)), 1); put('w_se_' + b, pc(Math.sqrt(variance(dd) / WP)), 1);
    put('w_se_indep_' + b, pc(Math.sqrt((variance(a) + variance(c)) / WP)), 1); put('w_z_' + b, mean(dd) / Math.sqrt(variance(dd) / WP), 1);
    put('w_coast_prog_' + b, pc(mean(ix.map((i) => kP[i]))), 1); put('w_coast_street_' + b, pc(mean(ix.map((i) => kS[i]))), 1);
    put('w_vi_prog_' + b, mean(ix.map((i) => vP[i])), 1); put('w_vi_street_' + b, mean(ix.map((i) => vS[i])), 1);
    d += W[b] * mean(dd); v1 += W[b] * W[b] * variance(dd) / WP; v0 += W[b] * W[b] * (variance(a) + variance(c)) / WP; pP += W[b] * mean(a); pS += W[b] * mean(c); qP += W[b] * mean(ix.map((i) => kP[i])); qS += W[b] * mean(ix.map((i) => kS[i]));
  }
  put('w_prog_all', pc(pP), 1); put('w_street_all', pc(pS), 1); put('w_diff_all', pc(d), 1); put('w_se_all', pc(Math.sqrt(v1)), 1); put('w_se_indep_all', pc(Math.sqrt(v0)), 1); put('w_z_all', d / Math.sqrt(v1), 1); put('w_k_all', v0 / v1, 1);
  put('w_gap_all', Math.abs(pc(d)), 1); put('w_gap_0', Math.abs(F.w_diff_0), 1);
  put('w_coast_prog_all', pc(qP), 1); put('w_coast_street_all', pc(qS), 1); put('w_n', NW, 0);
  put('w_need_real', need(pS * (1 - pS), Math.abs(pS - pP)), 0);               // real step-outs that tell the street's rate from the program's by this margin (95%, the program's rate taken as known)
  put('w_need_band1', need(F.w_street_1 / 100 * (1 - F.w_street_1 / 100), Math.abs(F.w_diff_1) / 100), 0);
  { const nR = need(F.w_street_0 / 100 * (1 - F.w_street_0 / 100), Math.abs(F.w_diff_0) / 100); put('w_need_R', nR, 0); put('w_need_R_all', nR / W[0], 0); }
  put('w_speed_mean_prog', U_PROG, 1); put('w_speed_lo', U_STREET[0], 1); put('w_speed_hi', U_STREET[1], 1); put('w_speed_mean_street', (U_STREET[0] + U_STREET[1]) / 2, 1);
  put('w_share_step', 100 * 0.5 * 0.8 * 0.35, 0);                               // the street draws a step-out in 14% of its frames (pedestrian, van, step-out)
  put('w_one_in_R', 1 / (0.5 * 0.8 * 0.35 * W[0]), 0);
  check(near(SWt.reduce((acc, s) => acc + s.u, 0) / NW, 1.4, 0.06), 'the street\'s walking speeds average the program\'s 1.4 m/s');
  check(F.w_street_0 < F.w_prog_0 && F.w_z_0 < -3, 'the street\'s slow and fast pedestrians let some of the closest step-outs through (z = ' + F.w_z_0 + ')');
}

lap('two worlds');
/* ═════════════ the widget ═════════════ */
const PAGE_FILE = path.join(root, dir, '11_what_braking_changes.html');
if (!fs.existsSync(PAGE_FILE)) console.error('no page yet: the widget is not driven');
else {
  const page = loadPage(PAGE_FILE, { dpr: 2, console: { log() {}, warn() {}, error() {} } });
  check(page.problems.length === 0, 'the page runs clean: ' + page.problems.slice(0, 2).join(' | '));
  const minus = '−', sgn = (x, d) => (x < 0 ? minus : '+') + Math.abs(x).toFixed(d);
  const outTxt = (o) => (o.stop ? 'stops ' + o.margin.toFixed(1) + ' m short' : o.col ? 'collision at ' + o.vImp.toFixed(1) + ' m/s' : 'passes clear');
  const MD = { bbba: modelOf('bbba'), q25u: modelOf('q25u'), aaaa: modelOf('aaaa') };
  const states = [[14, 0, 'bbba'], [14, 3, 'bbba'], [10, 0, 'bbba'], [20, 0, 'bbba'], [20, 0, 'aaaa'], [26, 2, 'bbba'], [18, 0, 'q25u'], [8, 0, 'bbba'], [30, 1, 'bbba']];
  page.check('w11-crn', true); page.set('w11-pair', 'act');
  const pairArr = (p) => [POOL[PAIR[p][0]], POOL[PAIR[p][1]]];
  function spreadOf(p) {
    const [a, b] = pairArr(p), dS = [], dI = [];
    for (let r = 0; r < 400; r++) {
      const rng = SV.rng(1000 + r), idx = Array.from({ length: NN }, (_, i) => i);
      for (let i = NN - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
      const f = idx.slice(0, 20), g = idx.slice(20, 40); dS.push(mean(f.map((i) => a[i] - b[i]))); dI.push(mean(f.map((i) => a[i])) - mean(g.map((i) => b[i])));
    }
    return { sdS: Math.sqrt(variance(dS)), sdI: Math.sqrt(variance(dI)) };
  }
  const wf = {};
  for (const [z, j, det] of states) {
    page.el('w11-z').value = String(z); page.el('w11-j').value = String(j); page.set('w11-det', det);        // the last set fires the page once for the whole state
    const seed = D.live[z][j], S = sit(PROG, U_PROG, seed), M = MD[det], r = ownDecision(S, M, M.thr), zc = S.z0 - S.r;
    const ob = outClosed(zc, S.x0, S.u, S.r, onsetOf(r.kd)), oc = outClosed(zc, S.x0, S.u, S.r, Infinity), mg = marginOf(S, r.kd), dl = (zc - dStop) / V0;
    check(Math.abs(S.z0 - z) < 0.25, 'live situation at ' + z + ' m is at ' + S.z0.toFixed(2));
    check(page.text('w11-td') === (r.kd < 0 ? 'never' : (r.kd * DT).toFixed(1) + ' s'), 'widget (' + [z, j, det] + '): decision time "' + page.text('w11-td') + '"');
    check(page.text('w11-dl') === dl.toFixed(2) + ' s', 'widget (' + [z, j, det] + '): deadline "' + page.text('w11-dl') + '" vs ' + dl.toFixed(2));
    check(page.text('w11-mg') === sgn(mg, 1) + ' m', 'widget (' + [z, j, det] + '): margin "' + page.text('w11-mg') + '" vs ' + sgn(mg, 1));
    check(page.text('w11-ob') === outTxt(ob) && page.text('w11-oc') === outTxt(oc), 'widget (' + [z, j, det] + '): outcomes "' + page.text('w11-ob') + '" / "' + page.text('w11-oc') + '" vs "' + outTxt(ob) + '" / "' + outTxt(oc) + '"');
    wf[[z, j, det].join(':')] = { kd: r.kd, mg: mg, dl: dl, ob: ob, oc: oc, z0: S.z0 };
    const kk = 'wf_' + z + '_' + j + '_' + det;
    put(kk + '_z0', S.z0, 1); put(kk + '_dec', r.kd < 0 ? -1 : r.kd * DT, 1); put(kk + '_dl', dl, 2); put(kk + '_mg', mg, 1); put(kk + '_bcol', +ob.col, 0); put(kk + '_bstop', +ob.stop, 0); put(kk + '_bv', ob.vImp, 1); put(kk + '_bm', ob.stop ? ob.margin : 0, 1); put(kk + '_ccol', +oc.col, 0); put(kk + '_cv', oc.vImp, 1);
  }
  for (const p of ['act', 'det', 'naive']) {
    page.set('w11-pair', p); const sp = spreadOf(p), [a, b] = pairArr(p);
    page.check('w11-crn', true); check(page.text('w11-sp') === (100 * sp.sdS).toFixed(1) + ' points', 'widget spread (' + p + ', shared): "' + page.text('w11-sp') + '" vs ' + (100 * sp.sdS).toFixed(1));
    page.check('w11-crn', false); check(page.text('w11-sp') === (100 * sp.sdI).toFixed(1) + ' points', 'widget spread (' + p + ', independent): "' + page.text('w11-sp') + '" vs ' + (100 * sp.sdI).toFixed(1));
    check(page.text('w11-kk') === (sp.sdI * sp.sdI / (sp.sdS * sp.sdS)).toFixed(1) + ' x', 'widget variance ratio (' + p + '): "' + page.text('w11-kk') + '"');
    check(page.text('w11-df') === sgn(100 * (mean(a) - mean(b)), 1) + ' points', 'widget effect (' + p + '): "' + page.text('w11-df') + '"');
  }
  page.check('w11-crn', true); page.set('w11-pair', 'act');
  const w = (z, j, det) => wf[[z, j, det].join(':')];
  put('w_dec_14', w(14, 0, 'bbba').kd < 0 ? -1 : w(14, 0, 'bbba').kd * DT, 1); put('w_dl_14', w(14, 0, 'bbba').dl, 2); put('w_mg_14', w(14, 0, 'bbba').mg, 1); put('w_z0_14', w(14, 0, 'bbba').z0, 1);
  put('w_ob_14_m', w(14, 0, 'bbba').ob.margin === null ? NaN : w(14, 0, 'bbba').ob.margin, 1); put('w_oc_14_v', w(14, 0, 'bbba').oc.vImp, 1);
  put('w_dec_10', w(10, 0, 'bbba').kd * DT, 1); put('w_mg_10', w(10, 0, 'bbba').mg, 1); put('w_ob_10_v', w(10, 0, 'bbba').ob.vImp, 1); put('w_oc_10_v', w(10, 0, 'bbba').oc.vImp, 1);
  put('w_dec_20', w(20, 0, 'bbba').kd * DT, 1); put('w_mg_20', w(20, 0, 'bbba').mg, 1); put('w_dec_20_naive', w(20, 0, 'aaaa').kd < 0 ? -1 : w(20, 0, 'aaaa').kd * DT, 1); put('w_mg_20_naive', w(20, 0, 'aaaa').mg, 1);
  put('w_dec_26', w(26, 2, 'bbba').kd * DT, 1); put('w_mg_26', w(26, 2, 'bbba').mg, 1);
  const s1 = spreadOf('act'), s2 = spreadOf('det'), s3 = spreadOf('naive');
  put('w_sdS_act', pc(s1.sdS), 1); put('w_sdI_act', pc(s1.sdI), 1); put('w_ratio_act', s1.sdI * s1.sdI / (s1.sdS * s1.sdS), 1);
  put('w_sdS_det', pc(s2.sdS), 1); put('w_sdI_det', pc(s2.sdI), 1); put('w_ratio_det', s2.sdI * s2.sdI / (s2.sdS * s2.sdS), 1);
  put('w_sdS_naive', pc(s3.sdS), 1); put('w_sdI_naive', pc(s3.sdI), 1); put('w_ratio_naive', s3.sdI * s3.sdI / (s3.sdS * s3.sdS), 1);
  check(page.problems.length === 0, 'the widget survives the states the prose names: ' + page.problems.slice(0, 2).join(' | '));
}

{ // the checkpoint: v = 10 m/s, a = 4 m/s^2, 0.5 s from decision to brake, a step-out 25 m ahead (near surface 24.75 m), a decision at 0.9 s
  const v = 10, a = 4, tau = 0.5, zc = 24.75, td = 0.9, d = v * tau + v * v / (2 * a), dl = (zc - d) / v, m = zc - v * td - d, o = outClosed(zc, 0, 0, 0.001, td + tau, v, a), on = outNum(zc, 0, 0, 0.001, td + tau, v, a);
  put('ck_d', d, 1); put('ck_dl', dl, 3); put('ck_late', td - dl, 3); put('ck_m', m, 2); put('ck_v', o.vImp, 1); check(near(o.vImp, on.vImp, 0.01) && o.col === on.col, 'checkpoint impact speed by closed form and by integration');
  put('ck_rho', 0.9, 1); put('ck_k', 1 / (1 - 0.9), 0);
}
lap('widget and checkpoint');
put('seconds', (Date.now() - T0) / 1000, 0);
check(Date.now() - T0 < 170000, 'the oracle runs in under 170 s (' + Math.round((Date.now() - T0) / 1000) + ' s)');
if (bad) { console.error(bad + ' check(s) failed'); if (process.env.L11_FACTS) console.log(JSON.stringify({ facts: F })); process.exit(1); }
console.log(JSON.stringify({ facts: F }));
