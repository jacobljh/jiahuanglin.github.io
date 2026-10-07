#!/usr/bin/env node
'use strict';
/* Oracle for synthetic_vision lesson 01 (free labels, and the wall).
 *
 * Re-derives every number the lesson quotes:
 *   - the geometry of the five free labels, with its own ray-cylinder intersection (depth and range of every mask pixel) and an 8 x 8 supersampled re-render of the mask areas;
 *   - two cells of tables.js (the program-trained and the street-trained detector at 40 frames) recomputed from scratch with its own threshold and miss-rate code,
 *     so that the table the lesson reads its curves from is anchored (build_tables.js --check recomputes three more);
 *   - everything else the prose quotes from the table (means over three seeds, the variance and bias split, the alarm rate at the carried threshold);
 *   - the frames of the widget (the first 24 frames of each world that hold a pedestrian who counts) and how many of them the detector of 160 frames finds;
 *   - the widget itself, driven through the states the prose names.
 * Last stdout line: {"facts": {...}}. */
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '../../../all_lessons');
const dir = fs.existsSync(path.join(root, 'synthetic_vision_new')) ? 'synthetic_vision_new' : 'synthetic_vision';
const SV = require(path.join(root, dir, 'street.js'));
require(path.join(root, dir, 'tables.js'));
const T = SV.TABLES;
const { loadPage } = require('../dom_probe.js');

let bad = 0;
const fail = (m) => { bad++; console.error('FAIL ' + m); };
const check = (c, m) => { if (!c) fail(m); };
const F = {};
const put = (k, v, d) => { F[k] = +(+v).toFixed(d === undefined ? 6 : d); };
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const C = SV.CAM, W = C.W, H = C.H, HW = W * H;

/* ── the pinhole: range over depth at the edge of the field of view ── */
put('edge_ratio', Math.sqrt(1 + Math.pow(W / 2 / C.f, 2)), 4);
check(Math.abs(C.f - (W / 2) / Math.tan(30 * Math.PI / 180)) < 0.05, 'f = 83.1 px is a 60-degree field of view');

/* ── the frames of the widget ── */
function frames(pipe, seed0) {
  const out = []; let s = seed0;
  while (out.length < 24) { const f = SV.sample(pipe, s++, { ped: true }); if (f.y && f.area >= SV.EXAM.minArea) out.push(f); }
  return out;
}
const PROG = frames(SV.SIM0, 1001), STREET = frames(SV.REAL, 2001);
const silOf = (f) => SV.render(f.scene, f.look, { only: 'ped', maps: false }).cov;

/* ── free labels, with an independent ray-cylinder intersection ── */
function checkLabels(f, name) {
  const ped = f.scene.ped, parts = ped.parts;
  let n = 0, ok = 0, worstZ = 0, worstR = 0;
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const q = j * W + i;
    if (f.cov[q] < 0.5 || f.id[q] !== ped.id) continue;
    n++;
    const tp = (i + 0.5 - W / 2) / C.f, rho = (C.V0 - j - 0.5) / C.f;
    let best = Infinity;
    for (const p of parts) {                                           // the side of each cylinder: a quadratic in the depth z along the ray (tp*z, hc + rho*z, z)
      const A = 1 + tp * tp, B = tp * p.x + p.z, D = B * B - A * (p.x * p.x + p.z * p.z - p.r * p.r);
      if (D <= 0) continue;
      const z = (B - Math.sqrt(D)) / A, h = C.hc + rho * z;
      if (z > 0 && h >= p.y0 && h <= p.y1 && z < best) best = z;
    }
    if (!isFinite(best)) continue;                                      // a top face (a short pedestrian's shoulders): not covered by this check
    ok++;
    worstZ = Math.max(worstZ, Math.abs(f.depth[q] - best));
    worstR = Math.max(worstR, Math.abs(f.range[q] - best * Math.sqrt(1 + tp * tp + rho * rho)));
  }
  check(n > 0 && ok >= 0.9 * n, name + ': an independent ray-cylinder hit explains ' + ok + ' of ' + n + ' mask pixels');
  check(worstZ < 1e-3 && worstR < 1e-3, name + ': depth and range agree with the independent intersection (worst ' + worstZ.toExponential(1) + ', ' + worstR.toExponential(1) + ')');
}
checkLabels(PROG[0], 'program frame 0');
const occIdx = STREET.findIndex((f) => f.mode === 'emerge' && f.area < 0.5 * silOf(f).reduce((a, b) => a + b, 0));
checkLabels(STREET[occIdx], 'street frame ' + occIdx);
{ // mask areas at 8 x 8 rays per pixel: the widget's 2 x 2 labels are quarter-pixel estimates, good to a few per cent for a large mask and to a quarter for a sliver
  const f = STREET[occIdx], hi = SV.render(f.scene, f.look, { SSh: 8, SSv: 8, maps: false }), sil = SV.render(f.scene, f.look, { only: 'ped', SSh: 8, SSv: 8, maps: false });
  let a8 = 0, s8 = 0; for (let q = 0; q < HW; q++) { a8 += hi.cov[q]; s8 += sil.cov[q]; }
  const s2 = silOf(f).reduce((a, b) => a + b, 0);
  check(Math.abs(a8 - f.area) / a8 < 0.35 && Math.abs(s8 - s2) / s8 < 0.1, 'mask and silhouette areas at 2 x 2 rays (' + f.area.toFixed(2) + ', ' + s2.toFixed(2) + ') are close to 8 x 8 (' + a8.toFixed(2) + ', ' + s8.toFixed(2) + ')');
  put('occl_i', occIdx, 0); put('occl_vis', f.area, 0); put('occl_sil', s2, 0); put('occl_vis8', a8, 0);
  check(f.area < s2, 'a hidden pedestrian has a smaller mask than silhouette');
}
{ const f = PROG[0], s = silOf(f).reduce((a, b) => a + b, 0); check(Math.abs(s - f.area) < 1e-6, 'in the open, mask = silhouette'); }

/* ── tables.js: two cells recomputed from scratch with this file's own exam ── */
const r5 = (x) => +Number(x).toPrecision(5);
function ownCell(pipeName, N, seed) {
  const pipe = pipeName === 'sim' ? SV.SIM0 : SV.REAL;
  const m0 = SV.train(SV.makeSet(pipe, N, SV.SEEDS.train + seed * 100000), { seed: seed });
  const model = { dim: m0.dim, w: Array.from(m0.w, r5), mu: Array.from(m0.mu, r5), sd: Array.from(m0.sd, r5) };
  const test = SV.real.test(3000), val = SV.real.val(1500);
  const score = (s) => SV.score(model, s.x).s;
  const sT = test.map(score), sV = val.map(score);
  const negV = sV.filter((_, i) => !val[i].y).sort((a, b) => a - b), thr = negV[Math.floor(0.9 * negV.length)];       // 10% of the pedestrian-free frames score above it
  let hits = 0, tot = 0; test.forEach((s, i) => { if (s.y && s.area >= 6) { tot++; if (sT[i] > thr) hits++; } });
  const real = 1 - hits / tot;
  const ownV = SV.makeSet(pipe, 800, SV.SEEDS.simVal), ownT = SV.makeSet(pipe, 1500, SV.SEEDS.simTest);
  const negO = ownV.map(score).filter((_, i) => !ownV[i].y).sort((a, b) => a - b), thrO = negO[Math.floor(0.9 * negO.length)];
  let h2 = 0, t2 = 0; ownT.forEach((s) => { if (s.y && s.area >= 6) { t2++; if (score(s) > thrO) h2++; } });
  return { real: real, own: 1 - h2 / t2, n: tot };
}
for (const [name, key] of [['sim', 'sim'], ['real', 'real']]) {
  const c = ownCell(key, 40, 1), cell = T.curve[key][40];
  check(Math.abs(c.real - cell.realMiss[0]) < 1e-4, name + ' N=40 seed 1: own street miss ' + c.real.toFixed(4) + ' vs table ' + cell.realMiss[0]);
  check(Math.abs(c.own - cell.ownMiss[0]) < 1e-4, name + ' N=40 seed 1: own program miss ' + c.own.toFixed(4) + ' vs table ' + cell.ownMiss[0]);
  if (key === 'sim') put('n_exam', c.n, 0);
}

/* ── how often the street's pedestrians step out from behind the van ── */
{
  const test = SV.real.test(3000); let withPed = 0, emerge = 0, ex = 0, exEmerge = 0;
  test.forEach((s) => { if (s.scene.ped) { withPed++; if (s.mode === 'emerge') emerge++; } if (s.y && s.area >= 6) { ex++; if (s.mode === 'emerge') exEmerge++; } });
  put('emerge_share', 100 * emerge / withPed, 0); put('emerge_exam', 100 * exEmerge / ex, 0);
  check(ex === F.n_exam, 'the exam counts the same pedestrians as before (' + ex + ')');
}

/* ── what the prose quotes from the table ── */
const pc = (a) => 100 * mean(a);
const curve = (w, N, f) => pc(T.curve[w][N][f]);
put('own_n10', curve('sim', 10, 'ownMiss'), 1); put('own_n40', curve('sim', 40, 'ownMiss'), 1);
put('sim_real_n10', curve('sim', 10, 'realMiss'), 1); put('sim_real_n40', curve('sim', 40, 'realMiss'), 1); put('sim_real_n2560', curve('sim', 2560, 'realMiss'), 1);
put('real_real_n10', curve('real', 10, 'realMiss'), 1); put('real_real_n40', curve('real', 40, 'realMiss'), 1); put('real_real_n2560', curve('real', 2560, 'realMiss'), 1);
put('var_sim', curve('sim', 10, 'realMiss') - curve('sim', 1600, 'realMiss'), 1);
put('var_real', curve('real', 10, 'realMiss') - curve('real', 1600, 'realMiss'), 1);
put('bias', curve('sim', 1600, 'realMiss') - curve('real', 1600, 'realMiss'), 1);
put('ceil', curve('real', 1600, 'realMiss'), 1); put('open_ceil', curve('real', 1600, 'missOpen'), 1); put('emerge_ceil', curve('real', 1600, 'missEmerge'), 1);
put('open_sim', curve('sim', 1600, 'missOpen'), 1); put('emerge_sim', curve('sim', 1600, 'missEmerge'), 1);
put('carried_sim', curve('sim', 1600, 'carriedFA'), 0); put('carried_real', curve('real', 1600, 'carriedFA'), 1);
put('ck_flat', Math.abs(curve('sim', 40, 'realMiss') - curve('sim', 2560, 'realMiss')), 1);
put('ck_better', curve('sim', 2560, 'realMiss') - curve('real', 40, 'realMiss'), 1);
check(F.own_n40 === 0 && F.ck_flat < 0.5, 'program-trained: no miss on the program from 40 frames, flat on the street from 40 to 2560');
check(F.bias > 30 && F.var_sim < 6 && F.var_real > 20, 'the variance of the program-trained curve is small and its bias large; the street-trained curve is variance');

/* ── the widget's frames: how many does the 160-frame detector find? ── */
{
  const m = T.models['sim@160'], model = { dim: 110, w: m.w, mu: m.mu, sd: m.sd };
  const fp = PROG.filter((f) => SV.score(model, f.x).s > m.thrOwn).length, fs_ = STREET.filter((f) => SV.score(model, f.x).s > m.thrReal).length;
  put('found_prog', fp, 0); put('found_street', fs_, 0);
  check(fp >= 22 && fs_ <= 8, 'the program-trained detector finds almost every program frame and few street frames (' + fp + ', ' + fs_ + ')');
}

/* ── the widget itself ── */
{
  const page = loadPage(path.join(root, dir, '01_free_labels_and_the_wall.html'), { dpr: 2, console: { log() {}, warn() {}, error() {} } });
  check(page.problems.length === 0, 'the page runs clean: ' + page.problems.slice(0, 2).join(' | '));
  const pctStr = (x) => (100 * x).toFixed(1) + '%';
  page.set('w01-n', 4);
  check(page.text('w01-found') === F.found_prog + ' / 24 + ' + F.found_street + ' / 24', 'widget: found counts at N=160 read "' + page.text('w01-found') + '"');
  check(page.text('w01-own') === pctStr(mean(T.curve.sim[160].ownMiss)) && page.text('w01-real') === pctStr(mean(T.curve.sim[160].realMiss)), 'widget: miss readouts at N=160');
  page.set('w01-n', 2);
  check(page.text('w01-own') === F.own_n40.toFixed(1) + '%' && page.text('w01-real') === F.sim_real_n40.toFixed(1) + '%' && page.text('w01-ref') === F.real_real_n40.toFixed(1) + '%', 'widget: N=40 readouts "' + [page.text('w01-own'), page.text('w01-real'), page.text('w01-ref')].join(' | ') + '"');
  page.set('w01-n', 9);
  check(page.text('w01-real') === F.sim_real_n2560.toFixed(1) + '%' && page.text('w01-ref') === F.real_real_n2560.toFixed(1) + '%', 'widget: N=2560 readouts');
  page.set('w01-n', 0);
  check(page.text('w01-own') === F.own_n10.toFixed(1) + '%' && page.text('w01-real') === F.sim_real_n10.toFixed(1) + '%' && page.text('w01-ref') === F.real_real_n10.toFixed(1) + '%', 'widget: N=10 readouts');
  page.set('w01-who', 'street'); page.set('w01-lab', 'street'); page.set('w01-i', occIdx);       // the drawn labels are checked above; here the page must run through these states
  check(page.problems.length === 0, 'the widget survives the states the prose names: ' + page.problems.slice(0, 2).join(' | '));
}

if (bad) { console.error(bad + ' check(s) failed'); process.exit(1); }
console.log(JSON.stringify({ facts: F }));
