#!/usr/bin/env node
'use strict';
/* build_l05.js — measures everything Lesson 5 (cover the cases) quotes and writes all_lessons/synthetic_vision/l05_data.js (SV.L05).
 *
 *   node tools/chain/verify/engine/build_l05.js --run [--workers 2]   runs every pending job in at most two worker processes (resumable: a finished job leaves w05/jobs/<id>.json), then merges
 *   node tools/chain/verify/engine/build_l05.js --merge               rewrites l05_data.js from the finished jobs
 *   node tools/chain/verify/engine/build_l05.js --check               recomputes two cells from scratch and compares them with the stored data
 *   node tools/chain/verify/engine/build_l05.js --job <id>            one job (what a worker runs)
 *
 * Jobs (seed block 15,000,000 +; trainings use the series protocol of syn_lab.js: N = 1600 frames, 3 seeds, the real exam):
 *   comp:<name>:<seed>   a component program on top of abba (street camera and light, program scene), name = dist | emerge | dist+emerge | clutter | van | body | dist+emerge+clutter | dist+emerge+van+clutter
 *   est:<n>:<seed>       the program whose pedestrian settings come from the ruler on n labelled frames (a different labelled sample for every seed)
 *   sweep:<lam>          dist+emerge with the clutter rate lam and no red poles (one seed): the label-free meter against a knob
 *   model:<abba|bbba>:<seed>  the exact-stage detectors: miss by case group, the stratified close-step-out exam, how many close step-outs the training set holds
 *   calib, pool, qprog, draws    cheap measurements: the ruler's bias and kappa, the 40,000-frame labelled pool and its error-against-n curves, the program's own case tables, 10^6 scene draws */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const ROOT = path.resolve(__dirname, '../../../..');
const DIR = path.join(ROOT, 'all_lessons/synthetic_vision');
const JOBS = path.join(ROOT, 'tools/chain/syn_notes/w05/jobs');
const OUT = path.join(DIR, 'l05_data.js');
const lab = require('./syn_lab.js');
const SV = lab.SV;
const L = require(path.join(DIR, 'l05_cases.js'));
const argv = process.argv.slice(2), has = (f) => argv.includes(f), arg = (f, d) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : d; };
const round = (x, d) => (x === null || x === undefined || !isFinite(x)) ? null : Math.round(x * Math.pow(10, d)) / Math.pow(10, d);
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const sd = (a) => { const m = mean(a); return Math.sqrt(mean(a.map((x) => (x - m) * (x - m)))); };
const quant = (a, p) => { const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const BASE = SV.hybrid(SV.SIM0, SV.REAL, { scene: 'a', look: 'b', sensor: 'b', label: 'a' });         // abba: street camera and light, the program's scene, the program's label rule
const SEED = { pool: 15000000, prog: 15100000, closeStep: 15300000, closeOpen: 15400000, calib: 15200000 };
const NS = [25, 50, 100, 200, 400, 800], POOL = 40000, PROG_N = 4000, Q_N = 12000;

/* programs by name */
const EXACT = { 'dist': ['dist'], 'emerge': ['emerge'], 'dist+emerge': ['dist', 'emerge'], 'clutter': ['clutter'], 'van': ['van'], 'body': ['body'],
  'dist+emerge+clutter': ['dist', 'emerge', 'clutter'], 'dist+emerge+van+clutter': ['dist', 'emerge', 'van', 'clutter'], 'none': [] };
const exactPipe = (name) => L.scenePipe(BASE, { exact: EXACT[name] });
const streetPipe = () => L.scenePipe(BASE, { exact: L.COMPONENTS });                                     // bbba

function tallyProgram(pipe, n, seed0) { const fr = SV.makeSet(pipe, n, seed0); const rs = L.rulers(fr); const t = L.tally(rs); return { t: t, rs: rs, fr: fr }; }

/* the ruler's bias and kappa, measured on a program with a deliberately wide range (8 to 26 m) and the step-out probability 0.3 */
let _calib = null;
function calib() {
  if (_calib) return _calib;
  const f = path.join(JOBS, 'calib.json');
  if (fs.existsSync(f)) return (_calib = JSON.parse(fs.readFileSync(f, 'utf8')));
  const pipe = L.scenePipe(BASE, { z: [8, 26], pEmerge: 0.3 }), fr = SV.makeSet(pipe, 6000, SEED.calib), rs = L.rulers(fr);
  const err = [], open = [];
  fr.forEach((x, i) => { const r = rs[i]; if (r && r.exam) { if (x.mode === 'open') err.push(r.z - x.scene.ped.parts[0].z); } });
  const t = L.tally(rs), s = L.stepShare(t.share), kappa = (s / (1 - s)) / (0.3 / 0.7);
  _calib = { bias: round(mean(err), 3), biasSd: round(sd(err), 3), n: err.length, stepShare: round(s, 4), kappa: round(kappa, 4) };
  return _calib;
}

/* ───────────── jobs ───────────── */
function pick(r) { return { realMiss: r.realMiss, missOpen: r.missOpen, missEmerge: r.missEmerge, auc: r.realAUC, logs: r.logsAlarm, dom: r.domAUC, thrReal: r.thrReal }; }
/* miss rate of the trained detector on three groups of the real test set's exam pedestrians: open within 16 m, open beyond 16 m, stepping out (truth: lab privilege) */
function groups(c) {
  const R = lab.real(), thr = c.result.thrReal, sT = c.scores.test, g = { near: [0, 0], far: [0, 0], step: [0, 0] };
  R.test.forEach((fr, i) => { if (fr.y && fr.area >= SV.EXAM.minArea) { const k = fr.mode === 'emerge' ? 'step' : fr.scene.ped.parts[0].z <= 16 ? 'near' : 'far'; g[k][0]++; if (sT[i] <= thr) g[k][1]++; } });
  return { near: round(g.near[1] / g.near[0], 4), nNear: g.near[0], far: round(g.far[1] / g.far[0], 4), nFar: g.far[0], step: round(g.step[1] / g.step[0], 4), nStep: g.step[0] };
}
function trained(pipe, seed, tag) { const c = lab.canonPipe(pipe, 1600, seed, tag); return Object.assign(pick(c.result), groups(c)); }
function jobComp(name, seed) { return trained(exactPipe(name), seed, name); }
function jobEst(n, seed) {
  const cb = calib(), fr = SV.real.labeled(n, SV.SEEDS.labeled + 1000 * (seed - 1)), rs = L.rulers(fr), est = L.estimate(rs, { bias: cb.bias, kappa: cb.kappa });
  const pipe = L.scenePipe(BASE, { z: [est.zlo, est.zhi], pEmerge: est.pEmerge });
  const r = trained(pipe, seed, 'E' + n), qp = tallyProgram(pipe, PROG_N, SEED.prog);
  return Object.assign(r, { n: n, nExam: est.n, nStep: est.nStep, zlo: round(est.zlo, 2), zhi: round(est.zhi, 2), share: round(est.share, 4), pEmerge: round(est.pEmerge, 4), A0: round(est.A0, 4), q: qp.t.share.map((x) => round(x, 4)) });
}
function jobSweep(lam) { const pipe = L.scenePipe(BASE, { exact: ['dist', 'emerge'], clutter: lam, pRed: 0 }); return Object.assign(trained(pipe, 1, 'lam' + lam), { lam: lam }); }
let _strat = null;
function strat() {
  if (_strat) return _strat;
  _strat = { cs: L.realCase('closeStepOut', 1200, SEED.closeStep), co: L.realCase('closeOpen', 1200, SEED.closeOpen) };
  return _strat;
}
function jobModel(which, seed) {
  const pipe = which === 'abba' ? BASE : streetPipe();
  const c = lab.canonPipe(pipe, 1600, seed, which), R = lab.real(), thr = c.result.thrReal, sT = c.scores.test;
  const g = groups(c);
  const S = strat(), grade = (set) => { let n = 0, k = 0; set.frames.forEach((fr) => { if (fr.y && fr.area >= SV.EXAM.minArea) { n++; if (SV.score(c.model, fr.x).s <= thr) k++; } }); return { n: n, miss: k / n }; };
  const a = grade(S.cs), b = grade(S.co);
  let held = 0; const t0 = SV.SEEDS.train + seed * 100000;
  for (let i = 0; i < 1600; i++) if (L.isClose(SV.drawScene(pipe.scene, SV.stream(t0 + i, 'scene')))) held++;
  return Object.assign(pick(c.result), g, {
    closeStep: round(a.miss, 4), nCloseStep: a.n, closeOpen: round(b.miss, 4), nCloseOpen: b.n, held: held });
}
function jobQprog() {
  const out = {};
  for (const name of ['none', 'dist', 'emerge', 'dist+emerge', 'dist+emerge+van+clutter']) { const t = tallyProgram(exactPipe(name), Q_N, SEED.prog).t; out[name] = { share: t.share.map((x) => round(x, 4)), n: t.n }; }
  const t = tallyProgram(streetPipe(), Q_N, SEED.prog).t; out.bbba = { share: t.share.map((x) => round(x, 4)), n: t.n };
  return out;
}
function jobDraws() {
  let close = 0, emerge = 0, ped = 0; const N = 1000000, s0 = 15000000;
  for (let i = 0; i < N; i++) { const sc = SV.drawScene(SV.REAL.scene, SV.stream(s0 + i, 'scene')); if (sc.ped) { ped++; if (sc.mode === 'emerge') { emerge++; if (L.isClose(sc)) close++; } } }
  return { N: N, ped: ped, emerge: emerge, close: close, rate: round(close / N, 6), oneIn: round(N / close, 1) };
}
function jobPool() {
  const cb = calib(), q0 = tallyProgram(BASE, PROG_N, SEED.prog).t.share, rec = [];
  const t0 = Date.now();
  for (let i = 0; i < POOL; i++) { const fr = SV.sample(SV.REAL, SEED.pool + i); rec.push({ R: L.ruler(L.labelSample(fr)), close: L.isClose(fr.scene), exam: fr.y && fr.area >= SV.EXAM.minArea, mode: fr.mode, z: fr.scene.ped ? fr.scene.ped.parts[0].z : 0 }); }
  const T = L.tally(rec.map((r) => r.R)), closeN = rec.filter((r) => r.close).length, closeExam = rec.filter((r) => r.close && r.exam).length;
  const ex = rec.filter((r) => r.exam), truth = { near: round(ex.filter((r) => r.mode === 'open' && r.z <= 16).length / ex.length, 4), far: round(ex.filter((r) => r.mode === 'open' && r.z > 16).length / ex.length, 4), step: round(ex.filter((r) => r.mode === 'emerge').length / ex.length, 4) };
  const out = { pool: POOL, nExam: T.n, cellFrames: T.counts.map((c) => round(c / POOL, 5)), share: T.share.map((x) => round(x, 4)), beyond: round(L.beyond(T.share), 4), step: round(L.stepShare(T.share), 4), cover: round(L.coverage(T.share, q0, 0.01), 4), closeFrames: closeN, closeCounted: closeExam, truth: truth, q0: q0.map((x) => round(x, 4)), curve: {}, sec: 0 };
  NS.forEach((n) => {
    const K = Math.floor(POOL / n), cv = [], by = [], st = [], zh = [], zl = [], pe = []; let none = 0, nc = [], noneCell = 0, cc = [];
    for (let k = 0; k < K; k++) {
      const blk = rec.slice(k * n, (k + 1) * n), rs = blk.map((r) => r.R), t = L.tally(rs), est = L.estimate(rs, { bias: cb.bias, kappa: cb.kappa }), c = blk.filter((r) => r.close).length;
      cv.push(L.coverage(t.share, q0, 0.01)); by.push(L.beyond(t.share)); st.push(L.stepShare(t.share)); zh.push(est.zhi); zl.push(est.zlo); pe.push(est.pEmerge); nc.push(c); if (!c) none++; if (!t.counts[1]) noneCell++; cc.push(t.counts[1]);
    }
    const band = (a, d) => ({ lo: round(quant(a, 0.1), d), med: round(quant(a, 0.5), d), hi: round(quant(a, 0.9), d), mean: round(mean(a), d + 1), sd: round(sd(a), d + 1) });
    out.curve[n] = { K: K, cover: band(cv, 4), beyond: band(by, 4), step: band(st, 4), zhi: band(zh, 2), zlo: band(zl, 2), pEmerge: band(pe, 4), none: round(none / K, 4), close: round(mean(nc), 3), noneCell: round(noneCell / K, 4), cell: round(mean(cc), 3) };
  });
  out.sec = round((Date.now() - t0) / 1000, 0);
  return out;
}
function runJob(id) {
  const p = id.split(':');
  switch (p[0]) {
    case 'comp': return jobComp(p[1], +p[2]);
    case 'est': return jobEst(+p[1], +p[2]);
    case 'sweep': return jobSweep(+p[1]);
    case 'model': return jobModel(p[1], +p[2]);
    case 'calib': return calib();
    case 'pool': return jobPool();
    case 'qprog': return jobQprog();
    case 'draws': return jobDraws();
  }
  throw new Error('unknown job ' + id);
}

/* ───────────── the job list ───────────── */
function allJobs() {
  const w1 = ['calib', 'draws', 'qprog', 'pool'], w2 = [], S = [1, 2, 3];
  const train = [];
  for (const wh of ['bbba', 'abba']) for (const s of S) train.push('model:' + wh + ':' + s);
  for (const nm of ['dist+emerge', 'dist', 'emerge', 'clutter', 'dist+emerge+clutter', 'van', 'body', 'dist+emerge+van+clutter']) for (const s of S) train.push('comp:' + nm + ':' + s);
  for (const n of [200, 800, 50]) for (const s of S) train.push('est:' + n + ':' + s);
  for (const lam of [0.75, 1, 1.5, 2]) train.push('sweep:' + lam);
  train.forEach((id, i) => (i % 2 ? w2 : w1).push(id));
  return [w1, w2];
}
const jobFile = (id) => path.join(JOBS, id.replace(/[:+]/g, '_') + '.json');

function worker(ids) {
  fs.mkdirSync(JOBS, { recursive: true });
  for (const id of ids) {
    if (fs.existsSync(jobFile(id))) continue;
    const t0 = Date.now(), r = runJob(id); r._sec = round((Date.now() - t0) / 1000, 0);
    fs.writeFileSync(jobFile(id), JSON.stringify(r));
    console.error('done ' + id + ' ' + r._sec + ' s');
  }
}
function runAll() {
  const queues = allJobs(), k = +arg('--workers', 2);
  const procs = queues.slice(0, k).map((q) => new Promise((res, rej) => {
    const p = spawn(process.execPath, [__filename, '--worker', q.join(',')], { stdio: ['ignore', 'inherit', 'inherit'] });
    p.on('close', (c) => c ? rej(new Error('worker failed')) : res());
  }));
  return Promise.all(procs).then(() => merge());
}

/* ───────────── merge ───────────── */
const PARTIAL = process.argv.includes('--partial');
function load(id) { if (PARTIAL && !fs.existsSync(jobFile(id))) return null; return JSON.parse(fs.readFileSync(jobFile(id), 'utf8')); }
function merge() {
  const S = [1, 2, 3], D = { protocol: { N: 1600, seeds: S, NS: NS, pool: POOL, progFrames: PROG_N } };
  D.calib = load('calib'); D.draws = load('draws'); D.pool = load('pool'); D.q = load('qprog');
  const FIELDS = ['realMiss', 'missOpen', 'missEmerge', 'logs', 'dom', 'near', 'far', 'step'];
  const cell = (rows) => { rows = rows.filter(Boolean); const o = {}; FIELDS.forEach((f) => { o[f] = rows.map((r) => r[f]); }); return o; };
  D.comp = {};
  for (const nm of ['dist', 'emerge', 'dist+emerge', 'clutter', 'van', 'body', 'dist+emerge+clutter', 'dist+emerge+van+clutter']) D.comp[nm] = cell(S.map((s) => load('comp:' + nm + ':' + s)));
  D.est = {};
  for (const n of [50, 200, 800]) { const rows = S.map((s) => load('est:' + n + ':' + s)).filter(Boolean); D.est[n] = Object.assign(cell(rows), { zlo: rows.map((r) => r.zlo), zhi: rows.map((r) => r.zhi), pEmerge: rows.map((r) => r.pEmerge), share: rows.map((r) => r.share), nExam: rows.map((r) => r.nExam), nStep: rows.map((r) => r.nStep), q: rows.map((r) => r.q) }); }
  D.models = {};
  for (const wh of ['abba', 'bbba']) {
    const rows = S.map((s) => load('model:' + wh + ':' + s)).filter(Boolean), o = cell(rows);
    ['near', 'far', 'step', 'closeStep', 'closeOpen', 'held', 'nNear', 'nFar', 'nStep', 'nCloseStep', 'nCloseOpen'].forEach((f) => { o[f] = rows.map((r) => r[f]); });
    D.models[wh] = o;
  }
  D.sweep = [0.75, 1, 1.5, 2].map((l) => { const r = load('sweep:' + l); if (!r) return null; return { lam: l, realMiss: r.realMiss, logs: r.logs, missOpen: r.missOpen, near: r.near, far: r.far, step: r.step }; }).filter(Boolean);
  const body = '/* l05_data.js — measured by tools/chain/verify/engine/build_l05.js (do not edit by hand).  Every number is a function of fixed seeds.\n' +
    ' * calib: the ruler\'s bias and kappa; pool: 40,000 labelled street frames through the ruler (population shares, error against n); q: the program\'s own case tables (shares among counted pedestrians, 8 cells:\n' +
    ' * band 0..3 x {open, stepping out});  comp / est / sweep: detectors trained on component and estimated programs (3 seeds);  models: the exact-stage detectors by case group and on the stratified close step-outs */\n' +
    '(function (root) {\n  var SV = root.SV || (root.SV = {});\n  SV.L05 = ' + JSON.stringify(D) + ';\n})(typeof window !== \'undefined\' ? window : (typeof globalThis !== \'undefined\' ? globalThis : this));\n' +
    'if (typeof module !== \'undefined\' && module.exports) module.exports = (typeof window !== \'undefined\' ? window : globalThis).SV.L05;\n';
  fs.writeFileSync(OUT, body);
  console.error('wrote ' + OUT + ' (' + body.length + ' bytes)');
}

/* ───────────── check: two cells from scratch ───────────── */
function check() {
  require(OUT); const D = SV.L05; let bad = 0;
  const near = (a, b, tol, m) => { if (!(Math.abs(a - b) <= tol)) { bad++; console.error('MISMATCH ' + m + ': ' + a + ' vs ' + b); } else console.error('ok ' + m + ' ' + a); };
  const c1 = jobComp('dist+emerge', 1); near(c1.realMiss, D.comp['dist+emerge'].realMiss[0], 1e-9, 'comp dist+emerge seed 1 realMiss'); near(c1.logs, D.comp['dist+emerge'].logs[0], 1e-9, '  logsAlarm');
  const e1 = jobEst(200, 2); near(e1.realMiss, D.est[200].realMiss[1], 1e-9, 'est 200 seed 2 realMiss'); near(e1.zhi, D.est[200].zhi[1], 1e-9, '  zhi');
  process.exit(bad ? 1 : 0);
}

if (has('--worker')) worker(arg('--worker', '').split(','));
else if (has('--job')) { const id = arg('--job'); fs.mkdirSync(JOBS, { recursive: true }); const r = runJob(id); fs.writeFileSync(jobFile(id), JSON.stringify(r)); console.log(JSON.stringify(r).slice(0, 400)); }
else if (has('--merge')) merge();
else if (has('--check')) check();
else if (has('--run')) runAll().catch((e) => { console.error(e); process.exit(1); });
else console.error('usage: build_l05.js --run | --merge | --check | --job <id>');
