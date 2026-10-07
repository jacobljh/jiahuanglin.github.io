#!/usr/bin/env node
'use strict';
/* build_l10.js — measures everything Lesson 10 (a little reality) quotes from trained detectors and writes all_lessons/synthetic_vision/l10_data.js (SV.L10).
 *
 *   node tools/chain/verify/engine/build_l10.js --run [--workers 2]   runs every pending job in at most two worker processes (resumable: a finished job leaves w10/jobs/<id>.json), then merges
 *   node tools/chain/verify/engine/build_l10.js --merge               rewrites l10_data.js from the finished jobs
 *   node tools/chain/verify/engine/build_l10.js --check               recomputes two cells from scratch and compares them with the stored data
 *   node tools/chain/verify/engine/build_l10.js --job <id>            one job (what a worker runs)
 *
 * Jobs (seed block 20,000,000 +; every training uses the series protocol of syn_lab.js: the exam of 3,000 real test frames at the threshold of 1,500 real validation frames; 3 seeds = 3 afternoons of evidence):
 *   R:<M>:<s>      real only: the fixed detector trained on the first M frames of the labelled stream of afternoon s (afternoons 1-6: the numeraire gets twice the afternoons, its trainings are small)
 *   F:<M>:<s>      fine-tune the naive program: 1,600 frames of SIM0 plus the same M real frames, every real frame weighing 1,600 / M (the real frames weigh as much in total as the synthetic ones)
 *   C:<M>:<s>      calibrate: the program rebuilt from evidence (bench session -> camera, 1,000 logs -> brightness, M labelled frames -> pedestrian settings), 1,600 frames of it; M = 0 uses no labelled frame
 *   CF:<M>:<s>     calibrate, then fine-tune: the calibrated program's 1,600 frames plus the M real frames, balanced weights
 *   W:<kind>:<M>:<w>:<s>   the same with another weight of a real frame (the weight sweep: one afternoon)
 *   grade          the arithmetic of grading on stored models and fresh real frames: paired against unpaired differences, the threshold's error against the number of pedestrian-free frames, the logs as a source of the threshold */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const ROOT = path.resolve(__dirname, '../../../..');
const DIR = path.join(ROOT, 'all_lessons/synthetic_vision');
const JOBS = path.join(ROOT, 'tools/chain/syn_notes/w10/jobs');
const OUT = path.join(DIR, 'l10_data.js');
const lab = require('./syn_lab.js');
const SV = lab.SV;
['evidence.js', 'tables.js', 'l03_camera.js', 'l04_light.js', 'l05_cases.js', 'l05_data.js'].forEach((f) => require(path.join(DIR, f)));
const L = require(path.join(DIR, 'l10_reality.js'));
const T = SV.TABLES;
const argv = process.argv.slice(2), has = (f) => argv.includes(f), arg = (f, d) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : d; };
const round = (x, d) => (x === null || x === undefined || !isFinite(x)) ? null : Math.round(x * Math.pow(10, d)) / Math.pow(10, d);
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const sd = (a) => { const m = mean(a); return Math.sqrt(mean(a.map((x) => (x - m) * (x - m)))); };
const S = [1, 2, 3], S6 = [1, 2, 3, 4, 5, 6], MS = L.M;       // three afternoons of evidence for every strategy, six for the real-only curve (the numeraire, and cheap)

/* ───────────── one trained cell, graded with the series' exam ───────────── */
function exam(model, own) {
  const R = lab.real(), sT = SV.scoreSet(model, R.test), sV = SV.scoreSet(model, R.val);
  const thr = SV.thrAtFPR(sV.filter((_, i) => !R.val[i].y), SV.EXAM.fa), ex = SV.exam(R.test, sT, { thr: thr });
  const byMode = (mode) => { let k = 0, n = 0; R.test.forEach((s, i) => { if (s.y && s.area >= SV.EXAM.minArea && s.mode === mode) { n++; if (sT[i] > thr) k++; } }); return n ? 1 - k / n : null; };
  const out = { realMiss: round(ex.miss, 4), missOpen: round(byMode('open'), 4), missEmerge: round(byMode('emerge'), 4), realAUC: round(ex.auc, 4), thrReal: round(thr, 4), realN: ex.n };
  if (own && own.length) {                                   // the miss rate on the pedestrians of the detector's own labelled training frames (grading on what it has seen)
    let n = 0, k = 0; own.forEach((f) => { if (f.y && f.area >= SV.EXAM.minArea) { n++; if (SV.score(model, f.x).s > thr) k++; } });
    out.trainMiss = n ? round(1 - k / n, 4) : null; out.trainN = n;
  }
  return out;
}
function cell(kind, M, s, wReal) {
  const r = s - 1, N = L.N, S0 = L.SEED, out = { kind: kind, M: M, seed: s };
  const labelled = M > 0 ? SV.real.labeled(M, S0.labelled + S0.step * r) : [];
  let syn = [], model, w = wReal === undefined ? (M > 0 ? L.balance(N, M) : 0) : wReal;
  if (kind === 'R') model = SV.train(labelled, { seed: s });
  else if (kind === 'F') { syn = SV.makeSet(SV.SIM0, N, S0.train + S0.step * r); model = L.trainMix(syn, labelled, { seed: s, wReal: w }); }
  else {                                                     // C and CF: the program rebuilt from this afternoon's evidence
    const ev = L.evidence(r, M), cal = L.calibrate(ev), e = cal.est;
    syn = SV.makeSet(cal.pipe, N, S0.train + S0.step * r);
    model = kind === 'C' ? SV.train(syn, { seed: s }) : L.trainMix(syn, labelled, { seed: s, wReal: w });
    out.est = { gamma: round(e.cam.gamma, 4), kappa: round(e.cam.kappa, 5), fw: round(e.cam.fw, 1), read: round(e.cam.read, 3), blur: round(e.cam.blur, 4), target: round(e.cam.target, 5), maxGain: e.cam.maxGain,
                lumLo: round(e.light.lum[0], 4), lumHi: round(e.light.lum[1], 4), used: e.light.used };
    if (e.scene) Object.assign(out.est, { n: e.scene.n, nStep: e.scene.nStep, zlo: round(e.scene.zlo, 2), zhi: round(e.scene.zhi, 2), pEmerge: round(e.scene.pEmerge, 4), share: round(e.scene.share, 4) });
  }
  if (kind === 'F' || kind === 'CF') out.w = round(w, 4);
  return Object.assign(out, exam(model, labelled));
}

/* ───────────── the arithmetic of grading, on stored models and fresh real frames ───────────── */
function jobGrade() {
  const R = lab.real(), mod = (k) => ({ dim: 110, w: T.models[k].w, mu: T.models[k].mu, sd: T.models[k].sd }), out = { pairs: [], thr: [] };
  const ex = []; R.test.forEach((f, i) => { if (f.y && f.area >= SV.EXAM.minArea) ex.push(i); });
  out.nExam = ex.length; out.nTest = R.test.length; out.ppf = round(ex.length / R.test.length, 5);
  const sc = {};
  ['swap@aaba', 'swap@abba', 'swap@bbba', 'real@1600'].forEach((k) => { const m = mod(k); sc[k] = { t: R.test.map((f) => SV.score(m, f.x).s), v: R.val.map((f) => SV.score(m, f.x).s), thr: T.models[k].thrReal }; });
  const hits = (k) => ex.map((i) => (sc[k].t[i] > sc[k].thr ? 1 : 0));
  [['swap@aaba', 'swap@abba'], ['swap@abba', 'swap@bbba'], ['swap@bbba', 'real@1600']].forEach(([a, b]) => {
    const ha = hits(a), hb = hits(b), n = ha.length, pa = 1 - mean(ha), pb = 1 - mean(hb);
    out.pairs.push({ a: a, b: b, n: n, pa: round(pa, 4), pb: round(pb, 4), sdPaired: round(L.pairedSd(ha, hb), 5), sdUnpaired: round(L.unpairedSd(pa, pb, n), 5) });
  });
  /* the threshold: the exam's operating point is the score that lets a tenth of the pedestrian-free frames alarm.  Estimated from M0 of them, how far does the miss rate move? (the model of the bbba program, 1 seed) */
  const k = 'swap@bbba', m = mod(k), pool = []; for (let i = 0; i < 6000; i++) pool.push(SV.score(m, SV.sample(SV.REAL, L.SEED.negPool + i, { ped: false }).x).s);
  const missAtThr = (thr) => 1 - mean(ex.map((i) => (sc[k].t[i] > thr ? 1 : 0)));
  const faAt = (thr) => pool.filter((v) => v > thr).length / pool.length, rng = SV.rng(2024);
  out.valNeg = R.val.filter((f) => !f.y).length; out.thrVal = round(sc[k].thr, 4); out.faAtVal = round(faAt(sc[k].thr), 4); out.missAtVal = round(missAtThr(sc[k].thr), 4);
  for (const fa of [0.05, 0.08, 0.1, 0.12, 0.15]) { const t = SV.thrAtFPR(pool, fa); out.thr.push({ fa: fa, miss: round(missAtThr(t), 4) }); }
  out.draws = [];
  for (const M0 of [50, 150, 500, 1500]) {
    const ms = [], fs_ = []; for (let rep = 0; rep < 400; rep++) { const t = L.thrDraw(pool, M0, rng); ms.push(missAtThr(t)); fs_.push(faAt(t)); }
    out.draws.push({ M0: M0, sdMiss: round(sd(ms), 4), sdFA: round(sd(fs_), 4), meanMiss: round(mean(ms), 4), meanFA: round(mean(fs_), 4) });
  }
  /* the unlabelled logs as the source of the threshold: 98% of them are pedestrian-free, so the 90th percentile of their scores sits where about 9% of pedestrian-free frames alarm */
  out.logs = [];
  for (const U of [1000, 4000]) {
    const ms = [], fs_ = [], reps = U === 1000 ? 12 : 3;
    for (let rep = 0; rep < reps; rep++) { const lg = SV.evidence.logs(U, 26000000 + 10000 * rep).map((f) => SV.score(m, f.x).s), t = SV.thrAtFPR(lg, 0.1); ms.push(missAtThr(t)); fs_.push(faAt(t)); }
    out.logs.push({ U: U, reps: reps, meanFA: round(mean(fs_), 4), sdFA: round(sd(fs_), 4), meanMiss: round(mean(ms), 4), sdMiss: round(sd(ms), 4) });
  }
  return out;
}

function runJob(id) {
  const p = id.split(':');
  if (p[0] === 'grade') return jobGrade();
  if (p[0] === 'W') return cell(p[1], +p[2], +p[4], +p[3]);
  return cell(p[0], +p[1], +p[2]);
}

/* ───────────── the job list ───────────── */
function allJobs() {
  const train = [];
  for (const M of MS) for (const s of S6) train.push('R:' + M + ':' + s);
  for (const s of S) train.push('C:0:' + s);
  for (const M of MS) for (const s of S) train.push('C:' + M + ':' + s);
  for (const M of MS) for (const s of S) train.push('CF:' + M + ':' + s);
  for (const M of MS) for (const s of S) train.push('F:' + M + ':' + s);
  for (const k of ['F', 'CF']) for (const w of [1, 4, 32, 128]) train.push('W:' + k + ':200:' + w + ':1');          // the weight of a real frame, one afternoon
  for (const w of [1, 8, 32]) train.push('W:CF:800:' + w + ':1');
  for (const w of [1, 4]) train.push('W:CF:50:' + w + ':1');
  const w1 = ['grade'], w2 = [];
  train.forEach((id, i) => (i % 2 ? w2 : w1).push(id));
  return [w1, w2];
}
const jobFile = (id) => path.join(JOBS, id.replace(/[:+.]/g, '_') + '.json');

function worker(ids) {
  fs.mkdirSync(JOBS, { recursive: true });
  for (const id of ids) {
    if (fs.existsSync(jobFile(id))) continue;
    const t0 = Date.now(), r = runJob(id); r._sec = round((Date.now() - t0) / 1000, 0);
    fs.writeFileSync(jobFile(id), JSON.stringify(r));
    console.error('done ' + id + ' ' + r._sec + ' s' + (r.realMiss !== undefined ? '  miss ' + r.realMiss : ''));
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
const PARTIAL = has('--partial');
function load(id) { const f = jobFile(id); if (!fs.existsSync(f)) { if (PARTIAL) return null; throw new Error('missing job ' + id); } return JSON.parse(fs.readFileSync(f, 'utf8')); }
function merge() {
  const D = { protocol: { N: L.N, seeds: S, seedsR: S6, M: MS, wRule: 'balance: a real frame weighs N / M', seed: L.SEED }, cells: {}, est: {}, sweep: [] };
  const FIELDS = ['realMiss', 'missOpen', 'missEmerge', 'realAUC', 'thrReal', 'trainMiss'];
  const pack = (rows) => { rows = rows.filter(Boolean); const o = {}; FIELDS.forEach((f) => { o[f] = rows.map((r) => r[f]); }); return o; };
  for (const kind of ['R', 'C', 'CF', 'F']) { D.cells[kind] = {}; for (const M of (kind === 'C' ? [0].concat(MS) : MS)) D.cells[kind][M] = pack((kind === 'R' ? S6 : S).map((s) => load(kind + ':' + M + ':' + s))); }
  for (const M of [0].concat(MS)) {
    const rows = S.map((s) => load('C:' + M + ':' + s)).filter(Boolean), o = {};
    Object.keys(rows[0].est).forEach((f) => { o[f] = rows.map((r) => r.est[f]); });
    D.est[M] = o;
  }
  D.grade = load('grade');
  D.ref = { naive: round(mean(T.swap.aaaa.realMiss), 5), exact: round(mean(T.swap.bbba.realMiss), 5), street: round(mean(T.swap.bbbb.realMiss), 5) };   // the series' table cells the curves are drawn against
  const sw = {}; for (const f of fs.readdirSync(JOBS)) { const m = /^W_/.test(f) ? JSON.parse(fs.readFileSync(path.join(JOBS, f), 'utf8')) : null; if (m) sw[m.kind + ':' + m.M + ':' + m.w] = { kind: m.kind, M: m.M, w: m.w, realMiss: m.realMiss, missOpen: m.missOpen, missEmerge: m.missEmerge }; }
  [['F', 200], ['CF', 50], ['CF', 200], ['CF', 800]].forEach(([k, M]) => { const b = D.cells[k][M]; sw[k + ':' + M + ':' + L.balance(L.N, M)] = { kind: k, M: M, w: L.balance(L.N, M), realMiss: b.realMiss[0], missOpen: b.missOpen[0], missEmerge: b.missEmerge[0] }; });   // the balanced weight is the main grid's afternoon 1
  D.sweep = Object.keys(sw).map((k) => sw[k]).sort((a, b) => (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : a.M - b.M || a.w - b.w));
  const body = '/* l10_data.js — measured by tools/chain/verify/engine/build_l10.js (do not edit by hand).  Every number is a function of fixed seeds.\n' +
    ' * cells[kind][M]: the exam miss of detectors trained with M real labelled frames (3 seeds = 3 afternoons of evidence), kind = R (real only), C (the program calibrated from evidence, 1,600 frames),\n' +
    ' * CF (calibrated program + the real frames), F (the naive program + the real frames); est[M]: what the calibration read; grade: the arithmetic of grading on stored models; sweep: the weight of a real frame */\n' +
    '(function (root) {\n  var SV = root.SV || (root.SV = {});\n  SV.L10 = ' + JSON.stringify(D) + ';\n})(typeof window !== \'undefined\' ? window : (typeof globalThis !== \'undefined\' ? globalThis : this));\n' +
    'if (typeof module !== \'undefined\' && module.exports) module.exports = (typeof window !== \'undefined\' ? window : globalThis).SV.L10;\n';
  fs.writeFileSync(OUT, body);
  console.error('wrote ' + OUT + ' (' + body.length + ' bytes)');
}

/* ───────────── check: two cells from scratch ───────────── */
function check() {
  require(OUT); const D = SV.L10; let bad = 0;
  const near = (a, b, tol, m) => { if (!(Math.abs(a - b) <= tol)) { bad++; console.error('MISMATCH ' + m + ': ' + a + ' vs ' + b); } else console.error('ok ' + m + ' ' + a); };
  const r1 = cell('R', 100, 2); near(r1.realMiss, D.cells.R[100].realMiss[1], 1e-9, 'R 100 seed 2');
  const c1 = cell('C', 50, 1); near(c1.realMiss, D.cells.C[50].realMiss[0], 1e-9, 'C 50 seed 1'); near(c1.est.zhi, D.est[50].zhi[0], 1e-9, '  zhi');
  process.exit(bad ? 1 : 0);
}

if (has('--worker')) worker(arg('--worker', '').split(','));
else if (has('--job')) { const id = arg('--job'); fs.mkdirSync(JOBS, { recursive: true }); const r = runJob(id); fs.writeFileSync(jobFile(id), JSON.stringify(r)); console.log(JSON.stringify(r).slice(0, 400)); }
else if (has('--merge')) merge();
else if (has('--check')) check();
else if (has('--run')) runAll().catch((e) => { console.error(e); process.exit(1); });
else console.error('usage: build_l10.js --run | --merge | --check | --job <id>');
