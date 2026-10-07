#!/usr/bin/env node
'use strict';
/* build_l09.js — measures Lesson 9's tables (replay, checks and leaks) and writes all_lessons/synthetic_vision/l09_data.js
 *
 *   node tools/chain/verify/engine/build_l09.js [--jobs 2]   runs every job in worker processes (at most --jobs at once), then merges
 *   node tools/chain/verify/engine/build_l09.js --job NAME   one job, written to tools/chain/syn_notes/w09/jobs/NAME.json
 *        jobs: fa  bench:<fault|clean>  canary:calA  canary:calB  canary:<fault>  exam:<fault>:<seed>  leak:<seed>  exit
 *   node tools/chain/verify/engine/build_l09.js --merge      rewrites l09_data.js from the job files
 *   node tools/chain/verify/engine/build_l09.js --check      recomputes two cells from scratch and compares them with l09_data.js
 *
 * What is measured (the factory under test is the exact-stage program bbba of Lesson 5; aaaa is the naive program of Lessons 1-2).
 *   fa      false alarms of every per-frame invariant on clean frames (6,000 of bbba, 3,000 of aaaa), the largest statistic as a share of its tolerance, and the batch checks on clean runs
 *   bench   one fault: the per-frame detection probability c of every invariant over 1,000 frames the fault touches, and a run of 1,000 frames as the faulty factory writes it: the batch checks,
 *           the integrity audit, the replay of every row, the pooled noise law per batch of 100
 *   canary  the 160-frame training check: the AUC on 240 fixed street frames of clean runs (calA: 30 runs to set the threshold, calB: 30 fresh runs to measure false alarms) and of runs with each fault (3 seeds)
 *   exam    the series' exam (N = 1,600, canonical seeds) for a run with a fault: the same frames as the cell bbba of tables.js, with the fault in the data path
 *   leak    scenes rendered under four looks and sensor draws (siblings), a random and a lineage split, three learners (1-NN, 10-NN, the fixed detector), the seed-reuse leak
 *   exit    the naive program aaaa through the whole gate: audit, batch checks, canary
 * Every number is a function of fixed seeds; there is no Math.random and no Date. */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const ROOT = path.resolve(__dirname, '../../../..');
const DIR = path.join(ROOT, 'all_lessons/synthetic_vision');
const JOBS = path.join(ROOT, 'tools/chain/syn_notes/w09/jobs');
const SV = require(path.join(DIR, 'street.js'));
require(path.join(DIR, 'tables.js'));
const L = require(path.join(DIR, 'l09_factory.js'));
const lab = require('./syn_lab.js');
const T = SV.TABLES;

const argv = process.argv.slice(2), has = (f) => argv.includes(f), arg = (f, d) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : d; };
const r4 = (x) => +Number(x).toFixed(4), r6 = (x) => +Number(x).toFixed(6);
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const sdev = (a) => { const m = mean(a); return Math.sqrt(a.reduce((x, y) => x + (y - m) * (y - m), 0) / (a.length - 1)); };
const hexBits = (bits) => { let s = ''; for (let i = 0; i < bits.length; i += 4) s += ((bits[i] ? 8 : 0) + (bits[i + 1] ? 4 : 0) + (bits[i + 2] ? 2 : 0) + (bits[i + 3] ? 1 : 0)).toString(16); return s; };

/* seed blocks (this lesson's private seeds start at 19,000,000) */
const SEED = { fa: 19000000, faA: 19100000, bench: 19200000, run: 19300000, calA: 19400000, calB: 19460000, fault: 19520000, leak: 19700000, exitRun: 19680000 };
const FAIL_IDS = L.INV.map((I) => I.id);

/* ───────────────────────────── fa: false alarms on clean frames ───────────────────────────── */
function margin(id, r) {                                   // the statistic as a share of its tolerance (largest over frames = how close a clean frame came)
  if (id === 'noise') return r.tol === 0 ? 0 : r.n === 0 ? r.v / r.tol : Math.abs(r.v - 1) / r.tol;
  if (id === 'gain') return r.tol === 1 ? 0 : r.v / r.tol;
  if (id === 'pixels') return r.v >= r.tol ? 0 : 1;
  if (id === 'ground' || id === 'range') return r.v / r.tol;
  return r.fail ? 1 : 0;
}
function faJob() {
  const out = {};
  [['bbba', 6000, SEED.fa], ['aaaa', 3000, SEED.faA]].forEach(([code, n, s0]) => {
    const pipe = L.program(code), decl = L.declOf(pipe), fails = {}, worst = {}, rows = [], recs = [];
    FAIL_IDS.forEach((k) => { fails[k] = 0; worst[k] = 0; });
    let nNoise = 0;
    for (let i = 0; i < n; i++) {
      const rec = L.make(pipe, L.seedsOf(s0 + i));
      L.INV.forEach((I) => { const r = I.run(rec, decl); if (r.fail) fails[I.id]++; worst[I.id] = Math.max(worst[I.id], margin(I.id, r)); if (I.id === 'noise' && r.n > 0) nNoise++; });
      rows.push(L.row(rec, i < Math.round(0.8 * n) ? 'train' : 'test'));
      if (i % 10 === 0 || recs.length < 100) recs.push(rec);
    }
    const batchFail = { dup: 0, lineage: 0, rate: 0 }, nb = Math.floor(n / 1000);
    for (let b = 0; b < nb; b++) { const r = L.batch(rows.slice(b * 1000, (b + 1) * 1000).map((x, i) => Object.assign({}, x, { split: i < 800 ? 'train' : 'test' })), decl); ['dup', 'lineage', 'rate'].forEach((k) => { if (r.fail[k]) batchFail[k]++; }); }
    const pools = []; let poolFail = 0;
    if (!pipe.sensor.ideal) for (let b = 0; b < n / 100; b++) { const rr = []; for (let i = 0; i < 100; i++) rr.push(L.make(pipe, L.seedsOf(s0 + b * 100 + i))); const p = L.noisePool(rr, decl); pools.push(p.v); if (p.fail) poolFail++; }
    out[code] = { n: n, fails: fails, worst: Object.fromEntries(Object.entries(worst).map(([k, v]) => [k, r4(v)])), noiseChecked: nNoise, batches: nb, batchFail: batchFail,
                  pool: pools.length ? { n: pools.length, mean: r4(mean(pools)), sd: r4(sdev(pools)), min: r4(Math.min.apply(null, pools)), max: r4(Math.max.apply(null, pools)), fails: poolFail } : null };
  });
  return out;
}

/* ───────────────────────────── bench: one fault ───────────────────────────── */
function benchJob(id) {
  const pipe = L.program('bbba'), decl = L.declOf(pipe), F = id === 'clean' ? null : L.faultById(id), NC = 1000, o = { id: id, f: F ? F.f : 0, where: F ? F.where : 'none', name: F ? F.name : 'no fault' };
  if (F && F.gen) {                                       // the fault touches every one of these frames: c = the share the invariants flag
    const cnt = {}, any = [];
    FAIL_IDS.forEach((k) => { cnt[k] = 0; });
    for (let i = 0; i < NC; i++) { const rec = F.gen(pipe, L.seedsOf(SEED.bench + i)), fl = L.check(rec, decl); fl.forEach((k) => { cnt[k]++; }); any.push(fl.length ? 1 : 0); }
    o.c = Object.fromEntries(FAIL_IDS.map((k) => [k, cnt[k] / NC])); o.cAny = any.reduce((a, b) => a + b, 0) / NC; o.anyBits = hexBits(any);
  }
  const run = L.run(pipe, 1000, SEED.run, F ? F.id : null), b = L.batch(run.rows, decl), au = L.audit(run, 1000, SV.rng(7));
  o.run = { n: 1000, hit: run.hit.filter(Boolean).length, dup: b.dup, lineage: b.lineage, ped: b.ped, lo: r4(b.lo), hi: r4(b.hi), rateFail: b.fail.rate, integrity: au.integrity.length, replay: au.replay.length };
  o.replayBits = hexBits(Array.from({ length: 1000 }, (_, i) => (au.replay.indexOf(i) >= 0 ? 1 : 0)));
  const ratios = [], fails = [];
  for (let s = 0; s < 10; s++) { const p = L.noisePool(run.recs.slice(s * 100, (s + 1) * 100), decl); ratios.push(r4(p.v)); fails.push(p.fail ? 1 : 0); }
  o.pool = { ratios: ratios, fails: fails };
  let flagged = 0, flaggedHit = 0, hits = 0;                               // per-frame invariants on the frames as stored, and on the ones the fault touched
  const runBits = [];
  run.recs.forEach((rec, i) => { const fl = L.check(rec, decl).length > 0; runBits.push(fl ? 1 : 0); if (fl) flagged++; if (run.hit[i]) { hits++; if (fl) flaggedHit++; } });
  o.run.flagged = flagged; o.run.cHit = hits ? r4(flaggedHit / hits) : 0; o.runBits = hexBits(runBits); o.hitBits = hexBits(run.hit.map((h) => (h ? 1 : 0)));
  return o;
}

/* ───────────────────────────── canary ───────────────────────────── */
function canaryRuns(ids, nRuns, seed0) {
  const pipe = L.program('bbba'), out = [];
  for (let r = 0; r < nRuns; r++) { const run = L.run(pipe, 1000, seed0 + r * 1000, null); out.push(r4(L.canary(run.recs, 800, r + 1).auc)); }
  return out;
}
function canaryJob(name) {
  const pipe = L.program('bbba');
  if (name === 'calA') return { aucs: canaryRuns(null, 30, SEED.calA) };
  if (name === 'calB') return { aucs: canaryRuns(null, 30, SEED.calB) };
  const fi = L.FAULTS.findIndex((f) => f.id === name), aucs = [];
  for (let s = 0; s < 3; s++) { const run = L.run(pipe, 1000, SEED.fault + (fi * 3 + s) * 1000, name); aucs.push(r4(L.canary(run.recs, 800, 101 + s).auc)); }
  return { id: name, aucs: aucs };
}

/* ───────────────────────────── exam: N = 1,600 on frames with a fault in the data path ───────────────────────────── */
function examJob(id, seed) {
  const pipe = L.program('bbba'), seed0 = SV.SEEDS.train + seed * 100000, frames = L.run(pipe, 1600, seed0, id === 'clean' ? null : id).recs;      // the same frames as the cell bbba, with the fault touching its own fraction f of them
  const model = lab.roundModel(SV.train(frames, { seed: seed })), R = lab.real(), sT = SV.scoreSet(model, R.test), sV = SV.scoreSet(model, R.val);
  const thr = SV.thrAtFPR(sV.filter((_, i) => !R.val[i].y), SV.EXAM.fa), ex = SV.exam(R.test, sT, { thr: thr });
  return { id: id, seed: seed, miss: r4(ex.miss), auc: r4(ex.auc), n: ex.n };
}

/* ───────────────────────────── leak ───────────────────────────── */
const LEAK = { scenes: 600, sibs: 4, ks: [1, 3, 10, 30, 100] };
function leakJob(seed) {
  const pipe = L.program('bbba'), items = L.withFeat(L.siblings(pipe, LEAK.scenes, LEAK.sibs, SEED.leak + seed * 10000)), out = { seed: seed, frames: items.length, cells: {}, ladder: {} };
  ['random', 'lineage'].forEach((kind) => {
    const sp = L.split(items, kind, seed), tr = sp.train.map((i) => ({ f: items[i].f, y: items[i].rec.y })), te = sp.test.map((i) => items[i]);
    out.cells[kind] = { train: sp.train.length, test: sp.test.length };
    L.LEARNERS.forEach((lr) => { out.cells[kind][lr] = r4(L.leakAUC(items, sp, lr, seed)); });
    LEAK.ks.forEach((k) => {
      const sc = L.knn(tr, te.map((t) => ({ f: t.f })), k), pos = [], neg = [];
      te.forEach((t, i) => { (t.rec.y ? pos : neg).push(sc[i]); });
      (out.ladder[k] = out.ladder[k] || {})[kind] = r4(SV.auc(pos, neg));
    });
  });
  /* the seed-reuse leak: 30% of the lineage test frames are replaced by exact copies of training frames (the same records), the way the bench fault does it */
  const sp = L.split(items, 'lineage', seed), tr = sp.train.map((i) => items[i]), te = sp.test.map((i) => items[i]), pick = L.shuffled(te.length, seed + 31), nDup = Math.round(0.3 * te.length), rg = SV.rng(seed + 77);
  const te2 = te.map((t, i) => t), dupIdx = pick.slice(0, nDup);
  dupIdx.forEach((i) => { te2[i] = tr[Math.floor(rg() * tr.length)]; });
  const trK = tr.map((t) => ({ f: t.f, y: t.rec.y }));
  const res = {};
  [['clean', te], ['reused', te2]].forEach(([nm, set]) => {
    const sc = L.knn(trK, set.map((t) => ({ f: t.f })), 1), pos = [], neg = [];
    set.forEach((t, i) => { (t.rec.y ? pos : neg).push(sc[i]); });
    res[nm] = { nn1: r4(SV.auc(pos, neg)) };
  });
  const model = SV.train(tr.map((t) => t.rec), { seed: seed });
  [['clean', te], ['reused', te2]].forEach(([nm, set]) => {
    const pos = [], neg = [], all = set.map((t) => SV.score(model, t.rec.x).s); set.forEach((t, i) => { (t.rec.y ? pos : neg).push(all[i]); });
    res[nm].detector = r4(SV.auc(pos, neg));
    if (nm === 'reused') { let hitD = 0, nPos = 0; dupIdx.forEach((i) => { if (set[i].rec.y) { nPos++; hitD++; } }); res.dupPos = nPos; }
  });
  out.reuse = res; out.nDup = nDup;
  return out;
}

/* ───────────────────────────── exit: the naive program through the whole gate ───────────────────────────── */
function exitJob() {
  const pipe = L.program('aaaa'), decl = L.declOf(pipe), run = L.run(pipe, 1000, SEED.exitRun, null), b = L.batch(run.rows, decl), au = L.audit(run, 1000, SV.rng(9)), aucs = [];
  let flagged = 0; run.recs.forEach((rec) => { if (L.check(rec, decl).length) flagged++; });
  for (let r = 0; r < 8; r++) { const rn = L.run(pipe, 1000, SEED.exitRun + 2000 + r * 1000, null); aucs.push(r4(L.canary(rn.recs, 800, r + 1).auc)); }
  return { n: 1000, flagged: flagged, dup: b.dup, lineage: b.lineage, rateFail: b.fail.rate, ped: b.ped, lo: r4(b.lo), hi: r4(b.hi), integrity: au.integrity.length, replay: au.replay.length, canary: aucs };
}

/* ───────────────────────────── job runner, merge, check ───────────────────────────── */
function allJobs() {
  const jobs = ['fa', 'exit', 'canary:calA', 'canary:calB', 'bench:clean'];
  L.FAULTS.forEach((f) => { jobs.push('bench:' + f.id); jobs.push('canary:' + f.id); });
  EXAM_FAULTS.concat(['clean']).forEach((id) => [1, 2, 3].forEach((s) => jobs.push('exam:' + id + ':' + s)));
  [1, 2, 3].forEach((s) => jobs.push('leak:' + s));
  return jobs;
}
const EXAM_FAULTS = ['palette', 'swap', 'flip', 'mask', 'upside'];
const fileOf = (name) => path.join(JOBS, name.replace(/:/g, '_') + '.json');
function runJob(name) {
  fs.mkdirSync(JOBS, { recursive: true });
  const t0 = process.hrtime.bigint(), p = name.split(':'); let r;
  if (p[0] === 'fa') r = faJob(); else if (p[0] === 'bench') r = benchJob(p[1]); else if (p[0] === 'canary') r = canaryJob(p[1]);
  else if (p[0] === 'exam') r = examJob(p[1], +p[2]); else if (p[0] === 'leak') r = leakJob(+p[1]); else if (p[0] === 'exit') r = exitJob(); else throw new Error('unknown job ' + name);
  fs.writeFileSync(fileOf(name), JSON.stringify(r));
  console.log(name, 'done in', (Number(process.hrtime.bigint() - t0) / 1e9).toFixed(1), 's');
}
function spawnJob(name) { return new Promise((res) => { const pr = spawn(process.execPath, [__filename, '--job', name], { stdio: ['ignore', 'inherit', 'inherit'] }); pr.on('exit', () => res()); }); }
async function build() {
  const jobs = allJobs().filter((j) => !fs.existsSync(fileOf(j)) || has('--force')), k = +arg('--jobs', 2); let next = 0;
  await Promise.all(Array.from({ length: k }, async () => { for (;;) { const i = next++; if (i >= jobs.length) return; await spawnJob(jobs[i]); } }));
  merge();
}
const load = (name) => JSON.parse(fs.readFileSync(fileOf(name), 'utf8'));
function merge() {
  const D = { version: 1, program: 'bbba', fa: load('fa'), exit: load('exit'), bench: {}, canary: {}, exam: {}, leak: {}, config: { nBench: 1000, nCanary: L.CANARY.n, nHeld: L.CANARY.nHeld, leak: LEAK } };
  ['clean'].concat(L.FAULTS.map((f) => f.id)).forEach((id) => { D.bench[id] = load('bench:' + id); });
  const A = load('canary:calA').aucs, B = load('canary:calB').aucs, thr = mean(A) - 3 * sdev(A);
  D.canary = { calA: A, calB: B, mean: r4(mean(A)), sd: r4(sdev(A)), thr: r4(thr), faFresh: B.filter((x) => x < thr).length, faults: {} };
  L.FAULTS.forEach((f) => { D.canary.faults[f.id] = load('canary:' + f.id).aucs; });
  EXAM_FAULTS.concat(['clean']).forEach((id) => { D.exam[id] = [1, 2, 3].map((s) => load('exam:' + id + ':' + s)); });
  [1, 2, 3].forEach((s) => { D.leak[s] = load('leak:' + s); });
  const text = '/* l09_data.js — written by tools/chain/verify/engine/build_l09.js; never edited by hand */\nSV.L09 = ' + JSON.stringify(D) + ';\n';
  fs.writeFileSync(path.join(DIR, 'l09_data.js'), text);
  console.log('wrote l09_data.js', text.length, 'bytes');
}
function check() {
  const sandbox = { SV: {} }; new Function('SV', fs.readFileSync(path.join(DIR, 'l09_data.js'), 'utf8'))(sandbox.SV);
  const D = sandbox.SV.L09; let bad = 0;
  const same = (a, b, m) => { if (Math.abs(a - b) > 1e-9) { console.error('MISMATCH', m, a, b); bad++; } else console.log('ok', m, a); };
  const b = benchJob('mask'); same(b.cAny, D.bench.mask.cAny, 'bench mask cAny'); same(b.run.integrity, D.bench.mask.run.integrity, 'bench mask integrity');
  const e = examJob('clean', 1); same(e.miss, D.exam.clean[0].miss, 'exam clean seed 1 miss'); same(e.miss, mean(T.swap.bbba.realMiss.slice(0, 1)), 'exam clean seed 1 vs tables.js');
  process.exit(bad ? 1 : 0);
}
if (has('--job')) runJob(arg('--job')); else if (has('--merge')) merge(); else if (has('--check')) check(); else build().catch((e) => { console.error(e); process.exit(1); });
