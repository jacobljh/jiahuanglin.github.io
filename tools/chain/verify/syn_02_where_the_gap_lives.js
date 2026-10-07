#!/usr/bin/env node
'use strict';
/* Oracle for synthetic_vision lesson 02 (where the gap lives).
 *
 * Re-derives every number the lesson quotes from the sixteen-program swap table of tables.js, with its own code:
 *   - the Shapley prices by enumerating all 24 orders of repair (the page uses the subset formula), and the check that they add up to the whole gain;
 *   - the gain of each stage given the state of the others, the pairwise gains, and the two roads (camera, light, scene and its reverse);
 *   - the rank correlation (Spearman, with average ranks) between the label-free score-gap meter and the real miss rate across the sixteen programs;
 *   - two cells of the table recomputed from scratch at 1600 frames with this file's own exam (threshold and miss rate), so the table is anchored;
 *   - the widget, driven along the path slider and through the check boxes.
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

/* hit rate (1 - miss) of the program with the given letters; stage order: scene, light, camera, label */
const hit = (c) => 1 - mean(T.swap[c].realMiss);
const code = (s, l, n, d) => (s ? 'b' : 'a') + (l ? 'b' : 'a') + (n ? 'b' : 'a') + (d ? 'b' : 'a');
const pts = (x) => 100 * x;

/* ── the table of the lesson: eight programs differing in scene, light and camera, the label left as the program's ── */
for (const [s, l, n] of [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1], [1, 1, 0], [1, 0, 1], [0, 1, 1], [1, 1, 1]]) {
  const c = code(s, l, n, 0), k = '' + s + l + n;
  put('m_' + k, pts(1 - hit(c)), 1); put('auc_' + k, mean(T.swap[c].realAUC), 3); put('logs_' + k, pts(mean(T.swap[c].logsAlarm)), 1);
}
F.logs_000 = Math.round(F.logs_000); F.logs_100 = Math.round(F.logs_100); F.logs_010 = Math.round(F.logs_010); F.logs_110 = Math.round(F.logs_110);
put('lab_diff', pts(hit('bbba') - hit('bbbb')), 1);
check(T.swap.aaab.realMiss.every((v, i) => v === T.swap.aaaa.realMiss[i]), 'aaab reproduces aaaa to the last digit (the label rules never disagree when the scene hides nobody)');
put('gap33', pts(hit('bbbb') - hit('aaaa')), 1);

/* ── Shapley by enumerating the orders ── */
function permutations(a) { if (a.length <= 1) return [a]; const out = []; a.forEach((x, i) => permutations(a.slice(0, i).concat(a.slice(i + 1))).forEach((p) => out.push([x].concat(p)))); return out; }
const phi = [0, 0, 0, 0], orders = permutations([0, 1, 2, 3]);
for (const o of orders) { const st = [0, 0, 0, 0]; for (const i of o) { const before = hit(code(...st)); st[i] = 1; phi[i] += (hit(code(...st)) - before) / orders.length; } }
check(orders.length === 24, '24 orders of repair');
check(Math.abs(phi.reduce((a, b) => a + b, 0) - (hit('bbbb') - hit('aaaa'))) < 1e-12, 'the prices add up to the whole gain');
put('phi_scene', pts(phi[0]), 1); put('phi_light', pts(phi[1]), 1); put('phi_cam', pts(phi[2]), 1); put('phi_label', pts(phi[3]), 1);
put('sh_scene', 100 * phi[0] / (phi[0] + phi[1] + phi[2] + phi[3]), 0); put('sh_light', 100 * phi[1] / (phi[0] + phi[1] + phi[2] + phi[3]), 0); put('sh_cam', 100 * phi[2] / (phi[0] + phi[1] + phi[2] + phi[3]), 0);
check(F.phi_cam > F.phi_light && F.phi_cam > F.phi_scene && Math.abs(F.phi_label) < 0.5, 'the camera is the largest price; the label is worth nothing');

/* ── the gain of a stage given the state of the others (label left as the program's) ── */
const gain = (stage, s, l, n) => { const a = [s, l, n, 0]; a[stage] = 0; const b = a.slice(); b[stage] = 1; return pts(hit(code(...b)) - hit(code(...a))); };
put('mg_cam_00', gain(2, 0, 0, 0), 1); put('mg_cam_11', gain(2, 1, 1, 0), 1);
put('mg_sc_00', gain(0, 0, 0, 0), 1); put('mg_sc_01', gain(0, 0, 0, 1), 1); put('mg_sc_10', gain(0, 0, 1, 0), 1); put('mg_sc_11', gain(0, 0, 1, 1), 1);
put('mg_li_00', gain(1, 0, 0, 0), 1); put('mg_li_11', gain(1, 1, 0, 1), 1);
const pair = (n) => pts(hit(code(1, 1, n, 0)) - hit(code(0, 0, n, 0)));
put('pair_cam0', pair(0), 1); put('pair_cam1', pair(1), 1);
check(F.mg_cam_11 > F.mg_cam_00 && F.mg_sc_11 > 2 * F.mg_sc_00 && F.pair_cam1 > F.pair_cam0, 'repairs compound');
/* the two roads */
put('step1', pts(hit('aaba') - hit('aaaa')), 1); put('step2', pts(hit('abba') - hit('aaba')), 1); put('step3', pts(hit('bbba') - hit('abba')), 1);
put('back1', pts(hit('baaa') - hit('aaaa')), 1); put('back2', pts(hit('bbaa') - hit('baaa')), 1); put('back3', pts(hit('bbba') - hit('bbaa')), 1);
check(F.step1 > F.back1 && F.step1 > F.step2, 'the camera first buys the most first');

/* the seed-to-seed wobble of the prices, and the product ("conjunction") picture of the losses */
{
  const hs = (c, k) => 1 - T.swap[c].realMiss[k], sd = (a) => { const m = mean(a); return Math.sqrt(mean(a.map((x) => (x - m) ** 2))); };
  const per = [0, 1, 2].map((k) => { const ph = [0, 0, 0, 0]; for (const o of orders) { const st = [0, 0, 0, 0]; for (const i of o) { const b = hs(code(...st), k); st[i] = 1; ph[i] += (hs(code(...st), k) - b) / orders.length; } } return ph; });
  put('phi_sd', pts(Math.max(...[0, 1, 2, 3].map((i) => sd(per.map((p) => p[i]))))), 1);
  const top = hit('bbba'), prod = hit('abba') * hit('baba') * hit('bbaa') / (top * top);
  put('prod_pred', pts(prod), 1); put('m_000_hit', pts(hit('aaaa')), 1);
  check(prod < hit('aaaa'), 'the product picture over-predicts the loss of the naive program');
}

/* ── the meter: Spearman correlation across the sixteen programs ── */
function ranks(a) { const idx = a.map((v, i) => [v, i]).sort((x, y) => x[0] - y[0]), r = new Array(a.length); let i = 0; while (i < idx.length) { let j = i; while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++; const avg = (i + j) / 2 + 1; for (let k = i; k <= j; k++) r[idx[k][1]] = avg; i = j + 1; } return r; }
function pearson(a, b) { const ma = mean(a), mb = mean(b); let n = 0, da = 0, db = 0; for (let i = 0; i < a.length; i++) { n += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2; } return n / Math.sqrt(da * db); }
const codes = Object.keys(T.swap), dom = codes.map((c) => mean(T.swap[c].domAUC)), miss = codes.map((c) => mean(T.swap[c].realMiss)), alarm = codes.map((c) => mean(T.swap[c].logsAlarm));
put('rho', pearson(ranks(dom), ranks(miss)), 2); put('rho_alarm', pearson(ranks(alarm), ranks(miss)), 2);
check(codes.length === 16 && F.rho > 0.7, 'sixteen programs, rank correlation of the meter with the exam is high (' + F.rho + ')');
put('dom_000', mean(T.swap.aaaa.domAUC), 2); put('dom_111', mean(T.swap.bbbb.domAUC), 2);

/* ── the checkpoint exercise (two stages) ── */
{ const v = { '': 0.20, A: 0.30, B: 0.25, AB: 0.50 }, a = ((v.A - v['']) + (v.AB - v.B)) / 2, b = ((v.B - v['']) + (v.AB - v.A)) / 2;
  put('ck_a', a, 3); put('ck_b', b, 3); put('ck_sum', a + b, 2); check(Math.abs(a + b - 0.30) < 1e-12, 'checkpoint prices sum to the gain'); }

/* ── two cells of the table, recomputed from scratch with this file's own exam ── */
const r5 = (x) => +Number(x).toPrecision(5);
function ownCell(pick, seed) {
  const p = {}; ['scene', 'look', 'sensor', 'label'].forEach((k, i) => { p[k] = pick[i]; });
  const pipe = SV.hybrid(SV.SIM0, SV.REAL, p);
  const m0 = SV.train(SV.makeSet(pipe, 1600, SV.SEEDS.train + seed * 100000), { seed: seed });
  const model = { dim: m0.dim, w: Array.from(m0.w, r5), mu: Array.from(m0.mu, r5), sd: Array.from(m0.sd, r5) };
  const test = SV.real.test(3000), val = SV.real.val(1500), logs = SV.real.logs(1000);
  const score = (s) => SV.score(model, s.x).s;
  const sT = test.map(score), sV = val.map(score), sL = logs.map(score);
  const negV = sV.filter((_, i) => !val[i].y).sort((a, b) => a - b), thr = negV[Math.floor(0.9 * negV.length)];
  let hits = 0, tot = 0; test.forEach((s, i) => { if (s.y && s.area >= 6) { tot++; if (sT[i] > thr) hits++; } });
  const ownV = SV.makeSet(pipe, 800, SV.SEEDS.simVal), negO = ownV.map(score).filter((_, i) => !ownV[i].y).sort((a, b) => a - b), thrO = negO[Math.floor(0.9 * negO.length)];
  return { miss: 1 - hits / tot, logs: sL.filter((v) => v > thrO).length / sL.length };
}
for (const [pick, seed] of [['abba', 1], ['baab', 2]]) {
  const c = ownCell(pick, seed);
  check(Math.abs(c.miss - T.swap[pick].realMiss[seed - 1]) < 1e-4, pick + ' seed ' + seed + ': own miss ' + c.miss.toFixed(4) + ' vs table ' + T.swap[pick].realMiss[seed - 1]);
  check(Math.abs(c.logs - T.swap[pick].logsAlarm[seed - 1]) < 1e-4, pick + ' seed ' + seed + ': own alarm rate ' + c.logs.toFixed(4) + ' vs table ' + T.swap[pick].logsAlarm[seed - 1]);
}

/* ── the widget ── */
{
  const page = loadPage(path.join(root, dir, '02_where_the_gap_lives.html'), { dpr: 2, console: { log() {}, warn() {}, error() {} } });
  check(page.problems.length === 0, 'the page runs clean: ' + page.problems.slice(0, 2).join(' | '));
  const PATH = ['aaaa', 'aaba', 'abba', 'bbba', 'bbbb'], STEPS = ['none', 'camera', 'camera + light', 'camera + light + scene', 'all four'];
  PATH.forEach((c, k) => {
    page.set('w02-path', k);
    check(page.text('w02-miss') === (100 * mean(T.swap[c].realMiss)).toFixed(1) + '%', 'widget path ' + k + ': miss readout "' + page.text('w02-miss') + '"');
    check(page.text('w02-alarm') === (100 * mean(T.swap[c].logsAlarm)).toFixed(1) + '%', 'widget path ' + k + ': alarm readout');
    check(page.text('w02-auc') === mean(T.swap[c].realAUC).toFixed(3) && page.text('w02-meter') === mean(T.swap[c].domAUC).toFixed(2), 'widget path ' + k + ': AUC and meter readouts');
    check(page.text('w02-path-v') === STEPS[k], 'widget path ' + k + ': path label "' + page.text('w02-path-v') + '"');
  });
  page.set('w02-path', 0); page.check('w02-scene', true); page.check('w02-light', true);
  check(page.text('w02-miss') === (100 * mean(T.swap.bbaa.realMiss)).toFixed(1) + '%' && page.text('w02-path-v') === 'custom', 'widget: scene + light only is a custom program (' + page.text('w02-miss') + ')');
  check(page.problems.length === 0, 'the widget survives the states the prose names: ' + page.problems.slice(0, 2).join(' | '));
}

if (bad) { console.error(bad + ' check(s) failed'); process.exit(1); }
console.log(JSON.stringify({ facts: F }));
