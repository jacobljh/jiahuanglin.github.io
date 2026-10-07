#!/usr/bin/env node
'use strict';
/* build_l03.js — the deterministic builder of all_lessons/synthetic_vision/l03_data.js (SV.L03), the tables of Lesson 3 (the camera is a measurement).
 *
 *   node build_l03.js                 run every missing training job (two worker processes), then the cheap tables, then write l03_data.js
 *   node build_l03.js --list          print the job list
 *   node build_l03.js --job K         run job K and print one JSON line (what the workers do)
 *   node build_l03.js --tables        recompute only the cheap tables (estimates by evidence amount, exposure pairs, CNR bins) and rewrite l03_data.js
 *   node build_l03.js --check         recompute three cells from scratch (one table cell of Lesson 2, one calibrated program, one switched-part program) and compare
 *
 * Training jobs (N = 1,600 frames, 3 seeds, the series' exam; seeds as syn_lab.canon):
 *   cal  k seed   the program whose camera is the CALIBRATED camera: estimates from an evidence kit of size k (L.kit), then the program SIM0 drawn through L.sense(estimates)
 *   abl  parts seed  the program SIM0 drawn through the street's own camera with only some of its parts switched on (N noise, B blur, A auto-exposure); the lab's privilege
 * The cells 'none' (aaaa) and 'NBA' (aaba) of the ablation are the cells of tables.js (the check shows L.sense with everything on reproduces aaba bit for bit).
 * Job results are cached in tools/chain/syn_notes/w03/jobs/ so that a rerun only computes what is missing. */
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const lab = require('./syn_lab.js');
const SV = lab.SV;
const root = path.resolve(__dirname, '../../../../all_lessons/synthetic_vision');
require(path.join(root, 'evidence.js'));
const L = require(path.join(root, 'l03_camera.js'));
const JOBDIR = path.resolve(__dirname, '../../syn_notes/w03/jobs');
const OUT = path.join(root, 'l03_data.js');

const KITS = [1, 2, 4, 8, 16, 32], PARTS = ['N', 'B', 'A', 'NB', 'NA', 'BA'], SEEDS = [1, 2, 3], N = 1600;
const jobs = [];
for (const parts of PARTS) for (const seed of SEEDS) jobs.push({ kind: 'abl', parts, seed });
for (const k of [4, 1, 16, 2, 8, 32]) for (const seed of SEEDS) jobs.push({ kind: 'cal', k, seed });
for (const seed of SEEDS) jobs.push({ kind: 'abl', parts: 'NB', look: 'b', seed });          // noise + blur but no auto-exposure, under the street's light (compare `abba`)
const swOf = (parts) => ({ noise: parts.indexOf('N') >= 0, blur: parts.indexOf('B') >= 0, ae: parts.indexOf('A') >= 0 });
const r4 = (x) => (x === null || x === undefined || !isFinite(x)) ? null : +x.toFixed(4);
const r5 = (x) => +Number(x).toPrecision(5);

/* the series' canonical experiment for a program whose sensor stage is L.sense(cam, sw): as syn_lab.canonPipe, with the frames drawn by L.makeSet */
function cell(cam, sw, seed, tag, pick) {
  const pipe = lab.pipeOf(pick || 'aaaa');                            // SIM0's scene, light and label (or the street's light: 'abaa'); the sensor stage is replaced
  const train = L.makeSet(pipe, cam, sw, N, SV.SEEDS.train + seed * 100000);
  const model = lab.roundModel(SV.train(train, { seed: seed }));
  const R = lab.real(), sc = (set) => SV.scoreSet(model, set), negs = (set, s) => s.filter((_, i) => !set[i].y);
  const sT = sc(R.test), sV = sc(R.val), sL = sc(R.logs);
  const thrReal = SV.thrAtFPR(negs(R.val, sV), SV.EXAM.fa), ex = SV.exam(R.test, sT, { thr: thrReal });
  const own = L.makeSet(pipe, cam, sw, 800, SV.SEEDS.simVal), sO = sc(own), thrOwn = SV.thrAtFPR(negs(own, sO), SV.EXAM.fa);
  const ownTest = L.makeSet(pipe, cam, sw, 1500, SV.SEEDS.simTest), sOT = sc(ownTest), exOwn = SV.exam(ownTest, sOT, { thr: thrOwn });
  const carried = SV.exam(R.test, sT, { thr: thrOwn });
  const byMode = (mode) => { let k = 0, n = 0; R.test.forEach((s, i) => { if (s.y && s.area >= SV.EXAM.minArea && s.mode === mode) { n++; if (sT[i] > thrReal) k++; } }); return n ? 1 - k / n : null; };
  const result = { realMiss: r4(ex.miss), missOpen: r4(byMode('open')), missEmerge: r4(byMode('emerge')), realAUC: r4(ex.auc), ownMiss: r4(exOwn.miss), ownAUC: r4(exOwn.auc),
    carriedFA: r4(carried.fa), logsAlarm: r4(SV.rate(sL, thrOwn)), domAUC: r4(SV.auc(sL, negs(ownTest, sOT))), thrReal: r5(thrReal), thrOwn: r5(thrOwn) };
  return { result, model };
}
function runJob(j) {
  const t0 = Date.now(); let cam, sw = { noise: true, blur: true, ae: true }, est = null;
  if (j.kind === 'abl') { cam = L.exactCam(); sw = swOf(j.parts); }
  else {
    const kit = L.kit(j.k, j.seed), e = L.calibrate(kit.flats, kit.edges, kit.logs);
    est = { gamma: e.gamma, kappa: e.kappa, fw: e.fw, read: e.read, blur: e.blur, target: e.target, maxGain: e.maxGain };
    cam = L.camOf(e);
  }
  const c = cell(cam, sw, j.seed, j.kind, j.look === 'b' ? 'abaa' : 'aaaa');
  const out = { job: j, est, result: c.result, sec: +((Date.now() - t0) / 1000).toFixed(1) };
  if (j.kind === 'cal' && j.k === 16 && j.seed === 1) out.model = c.model;      // the model the page scores with
  return out;
}

function jobFile(i) { return path.join(JOBDIR, 'job_' + i + '.json'); }
function runAll() {
  fs.mkdirSync(JOBDIR, { recursive: true });
  const todo = jobs.map((j, i) => i).filter((i) => !fs.existsSync(jobFile(i)));
  console.log(todo.length + ' of ' + jobs.length + ' jobs to run');
  return new Promise((resolve) => {
    let running = 0, next = 0, done = 0;
    const launch = () => {
      while (running < 2 && next < todo.length) {
        const i = todo[next++]; running++;
        const p = cp.spawn(process.execPath, [__filename, '--job', String(i)], { stdio: ['ignore', 'pipe', 'inherit'] });
        let buf = ''; p.stdout.on('data', (d) => { buf += d; });
        p.on('close', (code) => {
          running--; done++;
          const line = buf.trim().split('\n').filter((l) => l.startsWith('{')).pop();
          if (code === 0 && line) { fs.writeFileSync(jobFile(i), line); console.log('job ' + i + ' done (' + done + '/' + todo.length + ') ' + JSON.stringify(jobs[i]) + ' ' + JSON.parse(line).sec + ' s'); }
          else console.error('job ' + i + ' FAILED (exit ' + code + ')');
          if (next >= todo.length && running === 0) resolve(); else launch();
        });
      }
      if (!todo.length) resolve();
    };
    launch();
  });
}

function loadJobs() {
  const cells = { cal: {}, abl: {} }, ests = {}; let model = null;
  jobs.forEach((j, i) => {
    if (!fs.existsSync(jobFile(i))) return;
    const r = JSON.parse(fs.readFileSync(jobFile(i), 'utf8'));
    const key = j.kind === 'abl' ? j.parts + (j.look ? '@' + j.look : '') : String(j.k), tab = cells[j.kind];
    tab[key] = tab[key] || {};
    Object.keys(r.result).forEach((f) => { (tab[key][f] = tab[key][f] || [])[j.seed - 1] = r.result[f]; });
    if (r.est) { ests[key] = ests[key] || {}; Object.keys(r.est).forEach((f) => { (ests[key][f] = ests[key][f] || [])[j.seed - 1] = r.est[f]; }); }
    if (r.model) model = r.model;
  });
  return { cells, ests, model };
}

/* ───────────────────────────── the cheap tables ───────────────────────────── */
function stat(a) { const m = a.reduce((x, y) => x + y, 0) / a.length, s = a.length > 1 ? Math.sqrt(a.reduce((x, y) => x + (y - m) * (y - m), 0) / (a.length - 1)) : 0; return [m, s]; }
const cached = (name, fn) => { fs.mkdirSync(JOBDIR, { recursive: true }); const f = path.join(JOBDIR, 'tbl_' + name + '.json'); if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8')); const v = fn(); fs.writeFileSync(f, JSON.stringify(v)); return v; };
/* 1. estimates against the amount of evidence: R repetitions of the whole afternoon at each kit size (evidence blocks 100...) */
function tEst() {
  const R = 40, est = {};
  for (const k of KITS) {
    const rec = { gamma: [], kappa: [], fw: [], read: [], blur: [], target: [], maxGain: [] };
    for (let r = 0; r < R; r++) { const kit = L.kit(k, 100 + r), e = L.calibrate(kit.flats, kit.edges, kit.logs); Object.keys(rec).forEach((f) => rec[f].push(e[f])); }
    est[k] = {}; Object.keys(rec).forEach((f) => { const [m, s] = stat(rec[f]); est[k][f] = [+m.toPrecision(6), +s.toPrecision(3)]; });
  }
  return { reps: R, byK: est };
}
/* 2. the exposure log of the street (the series' 1,000 shared logs) and of the program (1,000 frames drawn through the street's camera): gain and the mean linear value after the gain, gamma = 2.2 */
function tExposure() {
  const gamma = SV.evidence.CAMERA.gamma, cam = L.exactCam(), all = { noise: true, blur: true, ae: true }, pipe = lab.pipeOf('aaaa');
  const sp = L.exposurePairs(SV.evidence.logs(1000), gamma), prog = [];
  for (let i = 0; i < 1000; i++) prog.push(L.sample(pipe, cam, all, 13900000 + i));
  const pp = L.exposurePairs(prog, gamma);
  return { street: { gain: sp.map((p) => +p.gain.toFixed(4)), post: sp.map((p) => +p.post.toFixed(5)) }, prog: { gain: pp.map((p) => +p.gain.toFixed(4)), post: pp.map((p) => +p.post.toFixed(5)) } };
}
/* 3. contrast-to-noise ratio of the exam pedestrians against the miss of two detectors (the exact-stage program's and the street-trained one, seed 1 of tables.js) and the ideal-observer bound */
function zFor(cells, fa) {                              // the per-cell false-alarm rate that gives a fraction fa of frames an alarm, and the matching normal quantile
  const p = 1 - Math.pow(1 - fa, 1 / cells); let lo = 0, hi = 8; for (let i = 0; i < 80; i++) { const m = (lo + hi) / 2; if (1 - L.Phi(m) > p) lo = m; else hi = m; } return (lo + hi) / 2;
}
function tCnr() {
  require(path.join(root, 'tables.js'));
  const TT = SV.TABLES, test = lab.real().test, cam = { gamma: 2.2, fw: 4000, read: 3 }, real = L.exactCam(), z = zFor(576, 0.1), bins = [0, 4, 8, 12, 20, 40, 1e9];
  const rows = [];
  test.forEach((f) => { if (!(f.y && f.area >= SV.EXAM.minArea)) return; const gain = L.gainOf(SV.render(f.scene, f.look, { maps: false }).rad, real), c = L.cnr(f.x, f.cov, gain, cam); if (isFinite(c)) rows.push({ f, gain, c }); });
  const miss = {};
  ['aaba', 'bbbb'].forEach((key) => { const m = TT.models['swap@' + key], model = { dim: 110, w: m.w, mu: m.mu, sd: m.sd }; miss[key] = rows.map((r) => (SV.score(model, r.f.x).s > m.thrReal ? 0 : 1)); });
  const out = { z, cells: 576, fa: 0.1, n: rows.length, bins, nBin: [], bound: [], aaba: [], bbbb: [], gain: [], area: [] };
  for (let b = 0; b + 1 < bins.length; b++) {
    const idx = []; rows.forEach((r, i) => { if (r.c >= bins[b] && r.c < bins[b + 1]) idx.push(i); });
    const mean = (g) => idx.reduce((s, i) => s + g(i), 0) / idx.length;
    out.nBin.push(idx.length); out.bound.push(+mean((i) => 1 - L.Phi(rows[i].c - z)).toFixed(4)); out.aaba.push(+mean((i) => miss.aaba[i]).toFixed(4)); out.bbbb.push(+mean((i) => miss.bbbb[i]).toFixed(4));
    out.gain.push(+mean((i) => rows[i].gain).toFixed(2)); out.area.push(+mean((i) => rows[i].f.area).toFixed(1));
  }
  out.all = { bound: +(rows.reduce((s, r) => s + 1 - L.Phi(r.c - z), 0) / rows.length).toFixed(4), aaba: +(miss.aaba.reduce((x, y) => x + y, 0) / rows.length).toFixed(4), bbbb: +(miss.bbbb.reduce((x, y) => x + y, 0) / rows.length).toFixed(4) };
  out.below4 = +(rows.filter((r) => r.c < 4).length / rows.length).toFixed(4);
  return out;
}
function tables() { return { est: cached('est', tEst), exposure: cached('exposure', tExposure), cnr: cached('cnr', tCnr) }; }

function writeData(extra) {
  const J = loadJobs();
  const E = extra || {}, data = { kits: KITS, parts: PARTS, N: N, cal: J.cells.cal, abl: J.cells.abl, calEst: J.ests, model: J.model, fix: 13950000, est: E.est && E.est.byK, estReps: E.est && E.est.reps, street: E.exposure && E.exposure.street, prog: E.exposure && E.exposure.prog, cnr: E.cnr };
  fs.writeFileSync(OUT, '/* l03_data.js — generated by tools/chain/verify/engine/build_l03.js; do not edit by hand. */\nSV.L03 = ' + JSON.stringify(data) + ';\n');
  console.log('wrote ' + OUT + ' (' + fs.statSync(OUT).size + ' bytes)');
}

if (require.main === module) {
  const a = process.argv.slice(2);
  if (a[0] === '--list') jobs.forEach((j, i) => console.log(i, JSON.stringify(j)));
  else if (a[0] === '--job') { const r = runJob(jobs[+a[1]]); console.log(JSON.stringify(r)); }
  else if (a[0] === '--tables') writeData(tables());
  else if (a[0] === '--check') {
    // recompute one calibrated cell, one switched-part cell, and the aaba cell of tables.js, and compare with what the jobs stored
    const J = loadJobs(); require(path.join(root, 'tables.js'));
    const one = (j) => runJob(j).result.realMiss;
    const checks = [[{ kind: 'abl', parts: 'NBA', seed: 1 }, SV.TABLES.swap.aaba.realMiss[0], 'NBA seed 1 = aaba seed 1 of tables.js'],
                    [{ kind: 'abl', parts: 'NA', seed: 2 }, J.cells.abl.NA && J.cells.abl.NA.realMiss[1], 'noise + exposure seed 2'],
                    [{ kind: 'cal', k: 4, seed: 3 }, J.cells.cal['4'] && J.cells.cal['4'].realMiss[2], 'calibrated k = 4 seed 3']];
    let bad = 0;
    checks.forEach(([j, want, what]) => { const got = one(j); const ok = Math.abs(got - want) < 1e-9; if (!ok) bad++; console.log((ok ? 'ok   ' : 'FAIL ') + what + ': ' + got + ' vs ' + want); });
    process.exit(bad ? 1 : 0);
  } else runAll().then(() => writeData(tables()));
}
module.exports = { jobs, runJob, cell, loadJobs };
