#!/usr/bin/env node
'use strict';
/* build_l06.js — measures Lesson 6's tables (the rare case) and writes all_lessons/synthetic_vision/l06_data.js
 *
 *   node tools/chain/verify/engine/build_l06.js [--jobs 2]     runs the jobs in worker processes (at most --jobs at once), then merges
 *   node tools/chain/verify/engine/build_l06.js --job seed1    one job, written to tools/chain/syn_notes/w06/jobs/seed1.json  (jobs: seed1 seed2 seed3 curveA curveB)
 *   node tools/chain/verify/engine/build_l06.js --merge        rewrites l06_data.js from the job files
 *   node tools/chain/verify/engine/build_l06.js --check        recomputes two cells from scratch and compares them with l06_data.js
 *
 * What is trained.  The program is the exact-stage program bbba of Lesson 5 (the street's scene, light and camera; the program's own label rule), N = 1,600 frames, seeds 1-3, the series' fixed detector.
 *   nat            the natural program (this is the cell bbba of tables.js: the builder checks it)
 *   qXXu / qXXw    a share q of the frames drawn in case R (a pedestrian steps out from behind the van closer than 12 m), q = 2, 5, 10, 25, 50 %, unweighted / weighted by p/q and (1-p)/(1-q)
 *   t50to25, t10to25   q = 50 % and 10 % with weights that restore a world in which R is 25 % of the frames (the weights are target/proposal, and the target need not be the street)
 *   ped90, ped10   the pedestrian share of the training frames changed to 90 % and 10 %, unweighted: a pure label shift
 *   natESS10/25/50 the natural program at N = the effective sample size of the weighted q = 10, 25, 50 % designs
 *   curve          the natural program at N = 400, 800, 3200 (seeds 1-3) and 6400, 11200 (seed 1): the learning curve of the rare slice
 * How it is graded (the series' exam, plus lab-privilege slices).  Real test 3,000 frames and real validation 1,500 frames as in syn_lab.js (threshold = 10 % false alarms on pedestrian-free validation frames);
 *   R slice     3,000 frames of the street generated directly in case R (seeds 16,500,000+): the miss rate over the pedestrians that count under four rules, and by visible fraction
 *   open slice  3,000 frames of the street with an OPEN pedestrian closer than 12 m (seeds 16,600,000+): the same detector at the same distances
 * Every number is a function of fixed seeds; there is no Math.random and no Date. */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const ROOT = path.resolve(__dirname, '../../../..');
const DIR = path.join(ROOT, 'all_lessons/synthetic_vision');
const SV = require(path.join(DIR, 'street.js'));
const L = require(path.join(DIR, 'l06_rare.js'));
const JOBDIR = path.join(ROOT, 'tools/chain/syn_notes/w06/jobs');
const OUT = path.join(DIR, 'l06_data.js');
const N0 = 1600, SEEDS = [1, 2, 3], QS = [0.02, 0.05, 0.1, 0.25, 0.5];
const NR_EVAL = 3000, NO_EVAL = 3000, SEED_R = 16500000, SEED_O = 16600000;
const r5 = (x) => +Number(x).toPrecision(5), r4 = (x) => (x === null || x === undefined || !isFinite(x)) ? null : +x.toFixed(4), r1 = (x) => +x.toFixed(1);
const PIPE = L.program();
const argv = process.argv.slice(2), has = (f) => argv.includes(f), arg = (f, d) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : d; };
const qid = (q) => 'q' + String(Math.round(q * 100)).padStart(2, '0');

/* ── the arms ── */
const ARMS = [{ id: 'nat', kind: 'mix', q: null, weighted: false }];
QS.forEach((q) => { ARMS.push({ id: qid(q) + 'u', kind: 'mix', q: q, weighted: false }); ARMS.push({ id: qid(q) + 'w', kind: 'mix', q: q, weighted: true }); });
ARMS.push({ id: 't50to25', kind: 'mix', q: 0.5, target: 0.25, weighted: true }, { id: 't10to25', kind: 'mix', q: 0.1, target: 0.25, weighted: true });
ARMS.push({ id: 'ped90', kind: 'ped', share: 0.9 }, { id: 'ped10', kind: 'ped', share: 0.1 });
[0.1, 0.25, 0.5].forEach((q) => ARMS.push({ id: 'natESS' + Math.round(q * 100), kind: 'nat', N: Math.round(N0 * L.essFrac(L.P_R, q)) }));
const CURVE_A = [{ N: 400, seeds: SEEDS }, { N: 800, seeds: SEEDS }, { N: 3200, seeds: SEEDS }];
const CURVE_B = [{ N: 6400, seeds: [1] }, { N: 11200, seeds: [1] }];
const MODEL_ARMS = ['nat', 'q02u', 'q02w', 'q05u', 'q05w', 'q10u', 'q10w', 'q25u', 'q25w', 'q50u', 'q50w'];

/* ── the real sets (built once per process) ── */
let _sets = null;
function sets() {
  if (_sets) return _sets;
  const lean = (f) => ({ x: f.x, y: f.y, area: f.area, full: f.full, mode: f.mode, isR: L.isR(f.scene), seed: f.seed });
  const make = (n, seed0) => { const out = []; for (let i = 0; i < n; i++) out.push(lean(SV.sample(SV.REAL, seed0 + i))); return out; };      // = SV.real.test / val, one frame at a time
  const drop = (set) => { set.forEach((f) => { delete f.cov; }); return set; };
  _sets = { test: make(3000, SV.SEEDS.test), val: make(1500, SV.SEEDS.val), R: drop(L.evalSet('R', NR_EVAL, SEED_R)), open: drop(L.evalSet('open', NO_EVAL, SEED_O)) };
  return _sets;
}

/* ── training sets ── */
function trainingSet(arm, seed) {
  const s0 = SV.SEEDS.train + seed * 100000;
  if (arm.kind === 'mix') { const pl = L.mixture(PIPE, N0, arm.q, s0, { seedR: 16100000 + seed * 100000, target: arm.target }); return { frames: pl.frames, weights: arm.weighted ? pl.weights : undefined, nR: pl.nR, ess: L.ess(pl.weights) }; }
  if (arm.kind === 'nat') { const pl = L.mixture(PIPE, arm.N, null, s0); return { frames: pl.frames, weights: undefined, nR: pl.nR, ess: arm.N }; }
  /* ped: the share of the frames that hold a pedestrian is set; the rest of the scene is the natural scene given that fact (want.ped forces the composition, not the law of the rest) */
  const nP = Math.round(arm.share * N0), frames = [];
  let nR = 0;
  const keep = (f) => { const g = L.lean(f); g.isR = L.isR(f.scene); if (g.isR) nR++; return g; };
  for (let i = 0; i < N0 - nP; i++) frames.push(keep(SV.sample(PIPE, 16300000 + seed * 100000 + i, { ped: false })));
  for (let i = 0; i < nP; i++) frames.push(keep(SV.sample(PIPE, 16350000 + seed * 100000 + i, { ped: true })));
  return { frames: frames, weights: undefined, nR: nR, ess: N0 };
}
function train(frames, weights, seed) {
  const m = SV.train(frames, { seed: seed, weights: weights });
  return { dim: m.dim, w: Array.from(m.w, r5), mu: Array.from(m.mu, r5), sd: Array.from(m.sd, r5) };
}

/* ── scoring many models on a set with one feature map per frame; the arithmetic is SV.score's, term by term ── */
function scoreMany(models, set) {
  const out = models.map(() => new Float64Array(set.length)), dim = SV.DIM;
  for (let i = 0; i < set.length; i++) {
    const fm = SV.featureMap(set[i].x), F = fm.F, nc = fm.nu * fm.nv;
    for (let k = 0; k < models.length; k++) {
      const m = models[k], w = m.w, mu = m.mu, sd = m.sd;
      let best = -Infinity;
      for (let c = 0; c < nc; c++) { let z = w[dim]; const o = c * dim; for (let j = 0; j < dim; j++) z += w[j] * (F[o + j] - mu[j]) / sd[j]; if (z > best) best = z; }
      out[k][i] = best;
    }
  }
  return out;
}

/* ── what one trained model is graded on ── */
function grade(S, sc, k) {
  const sT = sc.test[k], sV = sc.val[k], sR = sc.R[k], sO = sc.open[k];
  const negV = []; for (let i = 0; i < S.val.length; i++) if (!S.val[i].y) negV.push(sV[i]);
  const thr = SV.thrAtFPR(negV, SV.EXAM.fa), ex = SV.exam(S.test, Array.from(sT), { thr: thr });
  const byMode = (mode) => { let h = 0, n = 0; S.test.forEach((s, i) => { if (s.y && s.area >= SV.EXAM.minArea && s.mode === mode) { n++; if (sT[i] > thr) h++; } }); return n ? 1 - h / n : null; };
  const R = {}; L.RULES.forEach((r) => { R[r] = r4(L.sliceMiss(S.R, sR, thr, r).miss); });
  const hits = new Array(L.FRAC_EDGES.length - 1).fill(0);
  S.R.forEach((f, i) => { if (f.area >= 1 && sR[i] > thr) hits[L.fracBin(f)]++; });
  let tn = 0, th = 0; S.test.forEach((s, i) => { if (s.isR && s.y && s.area >= SV.EXAM.minArea) { tn++; if (sT[i] > thr) th++; } });
  let fa0n = 0, fa0 = 0; for (let i = 0; i < S.val.length; i++) if (!S.val[i].y) { fa0n++; if (sV[i] > 0) fa0++; }
  return { exam: r4(ex.miss), open: r4(byMode('open')), emerge: r4(byMode('emerge')), auc: r4(ex.auc), thr: r5(thr), fa0: r4(fa0 / fa0n), R: R, psy: hits, openClose: r4(L.sliceMiss(S.open, sO, thr, 'exam').miss), testR: r4(tn ? 1 - th / tn : null), testRn: tn };
}

/* ── a job: train a list of (arm, seed) cells, score them all in one pass, grade ── */
function runCells(cells) {
  const S = sets(), t0 = Date.now(), models = [], infos = [];
  cells.forEach((c, i) => {
    const ts = trainingSet(c.arm, c.seed), m = train(ts.frames, ts.weights, c.seed);
    models.push(m); infos.push({ nR: ts.nR, ess: +ts.ess.toFixed(2), N: ts.frames.length });
    console.error(c.arm.id + ' seed ' + c.seed + ' trained (' + (i + 1) + '/' + cells.length + ', ' + Math.round((Date.now() - t0) / 1000) + ' s)');
  });
  const sc = { test: scoreMany(models, S.test), val: scoreMany(models, S.val), R: scoreMany(models, S.R), open: scoreMany(models, S.open) };
  console.error('scored ' + models.length + ' models, ' + Math.round((Date.now() - t0) / 1000) + ' s');
  return cells.map((c, k) => Object.assign({ id: c.arm.id, seed: c.seed }, infos[k], grade(S, sc, k), { model: c.seed === 1 && MODEL_ARMS.includes(c.arm.id) ? { w: models[k].w, mu: models[k].mu, sd: models[k].sd } : undefined }));
}
function jobCells(name) {
  if (/^seed\d$/.test(name)) return ARMS.map((a) => ({ arm: a, seed: +name.slice(4) }));
  const spec = name === 'curveA' ? CURVE_A : CURVE_B, cells = [];
  spec.forEach((s) => s.seeds.forEach((sd) => cells.push({ arm: { id: 'curve' + s.N, kind: 'nat', N: s.N }, seed: sd })));
  return cells;
}
function runJob(name) {
  fs.mkdirSync(JOBDIR, { recursive: true });
  const rows = runCells(jobCells(name));
  fs.writeFileSync(path.join(JOBDIR, name + '.json'), JSON.stringify(rows));
  console.error('job ' + name + ' written');
}

/* ── merge the jobs into l06_data.js ── */
function merge() {
  const rows = []; ['seed1', 'seed2', 'seed3', 'curveA', 'curveB'].forEach((n) => rows.push.apply(rows, JSON.parse(fs.readFileSync(path.join(JOBDIR, n + '.json'), 'utf8'))));
  const S = sets(), by = (id) => rows.filter((r) => r.id === id).sort((a, b) => a.seed - b.seed);
  const per = (rs, f) => rs.map((r) => r[f]);
  const D = { N: N0, seeds: SEEDS, p: L.P_R, qs: QS, arms: {}, curve: {}, models: {}, sets: {} };
  const cnt = {}; L.RULES.forEach((r) => { cnt[r] = S.R.filter((f) => L.counts(f, r)).length; });
  const binN = new Array(L.FRAC_EDGES.length - 1).fill(0); S.R.forEach((f) => { if (f.area >= 1) binN[L.fracBin(f)]++; });
  const strip = binN.map((_, k) => SEED_R + S.R.findIndex((f) => f.area >= 1 && L.fracBin(f) === k));                // the first frame of the slice in each bin of visible fraction: the page's strip
  D.sets = { R: { n: NR_EVAL, seed0: SEED_R, counts: cnt, edges: L.FRAC_EDGES, binN: binN, strip: strip }, open: { n: NO_EVAL, seed0: SEED_O, counts: { exam: S.open.filter((f) => L.counts(f, 'exam')).length } } };
  ARMS.forEach((a) => {
    const rs = by(a.id), o = { q: a.q === undefined ? null : a.q, weighted: !!a.weighted, target: a.target === undefined ? null : a.target, N: rs[0].N };
    ['nR', 'ess', 'exam', 'open', 'emerge', 'auc', 'thr', 'fa0', 'openClose', 'testR', 'testRn'].forEach((f) => { o[f] = per(rs, f); });
    o.R = {}; L.RULES.forEach((r) => { o.R[r] = rs.map((x) => x.R[r]); });
    o.psy = rs.map((x) => x.psy);
    D.arms[a.id] = o;
    if (rs[0].model && MODEL_ARMS.includes(a.id)) D.models[a.id] = { w: rs[0].model.w, mu: rs[0].model.mu, sd: rs[0].model.sd, thr: rs[0].thr };
  });
  const curveN = [400, 800, 1600, 3200, 6400, 11200];
  curveN.forEach((N) => {
    const rs = N === 1600 ? by('nat') : by('curve' + N), o = {};
    ['nR', 'exam', 'open', 'openClose', 'thr'].forEach((f) => { o[f] = per(rs, f); });
    o.R = rs.map((x) => x.R.exam); o.Rpixel = rs.map((x) => x.R.pixel);
    D.curve[N] = o;
  });
  const body = '/* l06_data.js — measured by tools/chain/verify/engine/build_l06.js (do not edit by hand).  Every cell is a function of fixed seeds.\n' +
    ' * arms[id]  : N = 1600 frames of the exact-stage program bbba with a share q of them in case R (a close step-out), unweighted (u) or weighted (w); per-seed arrays (seeds 1-3):\n' +
    ' *             nR examples of R in training, ess of the weights p/q, exam / open / emerge = miss on the real test set (all, open, step-out pedestrians), thr = the score at 10 % false alarms, fa0 = alarm rate at a fixed score 0,\n' +
    ' *             R[rule] = miss on the 3000-frame R slice, openClose = miss on open pedestrians at the same distances, psy = hits by visible fraction of the silhouette, testR = miss on the R pedestrians of the real test set\n' +
    ' * curve[N]  : the natural program at N frames;  models[id] : seed-1 weights with thr, to score a frame live */\n' +
    '(function (root) {\n  var SV = root.SV || (root.SV = {});\n  SV.L06 = ' + JSON.stringify(D) + ';\n})(typeof window !== \'undefined\' ? window : (typeof globalThis !== \'undefined\' ? globalThis : this));\n' +
    'if (typeof module !== \'undefined\' && module.exports) module.exports = (typeof globalThis !== \'undefined\' ? globalThis : this).SV;\n';
  fs.writeFileSync(OUT, body);
  console.log('wrote ' + path.relative(ROOT, OUT) + ' (' + body.length + ' bytes, ' + rows.length + ' trainings)');
}

/* ── parallel runner ── */
function spawnJob(name) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [__filename, '--job', name], { stdio: ['ignore', 'inherit', 'inherit'] });
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error('job failed: ' + name))));
  });
}
async function build() {
  const jobs = ['curveB', 'seed1', 'seed2', 'seed3', 'curveA'], k = +arg('--jobs', 2); let next = 0;
  await Promise.all(Array.from({ length: k }, async () => { for (;;) { const i = next++; if (i >= jobs.length) return; await spawnJob(jobs[i]); } }));
  merge();
}

/* ── check: two cells from scratch against the stored table ── */
function check() {
  require(OUT); const D = (global.SV || globalThis.SV).L06;
  let bad = 0;
  const cells = [{ arm: ARMS.find((a) => a.id === 'q10u'), seed: 2 }, { arm: ARMS.find((a) => a.id === 'q25w'), seed: 3 }];
  runCells(cells).forEach((r, i) => {
    const a = D.arms[cells[i].arm.id], s = cells[i].seed - 1;
    [['exam', r.exam, a.exam[s]], ['open', r.open, a.open[s]], ['R.exam', r.R.exam, a.R.exam[s]], ['R.pixel', r.R.pixel, a.R.pixel[s]], ['openClose', r.openClose, a.openClose[s]], ['thr', r.thr, a.thr[s]], ['nR', r.nR, a.nR[s]]].forEach(([n, live, stored]) => {
      if (Math.abs(live - stored) > 1e-9) { bad++; console.error('MISMATCH', cells[i].arm.id, 'seed', cells[i].seed, n, 'stored', stored, 'live', live); }
    });
  });
  console.log(bad ? bad + ' mismatches' : 'l06_data.js agrees with a live recomputation of two cells');
  process.exit(bad ? 1 : 0);
}

if (has('--job')) runJob(arg('--job')); else if (has('--merge')) merge(); else if (has('--check')) check(); else build().catch((e) => { console.error(e); process.exit(1); });
