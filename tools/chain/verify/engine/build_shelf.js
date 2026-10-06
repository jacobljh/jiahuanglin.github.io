#!/usr/bin/env node
/* build_shelf.js — measures lesson 19's table on the Bench and writes it into all_lessons/robot_model_training/shelf_lab.js
 *
 *   node tools/chain/verify/engine/build_shelf.js            (runs every measurement with shelf_lab.js's own constants, one process per lineage, and rewrites the TABLE block)
 *   node tools/chain/verify/engine/build_shelf.js --check    (recomputes the cheap cells live and compares them with the stored table)
 *
 * What is measured (all through the engine paths of shelf_lab.js and dagger_lab.js; the lesson's oracle re-derives every cell with code of its own and asserts equality):
 *   gain      success points a set of 800 labelled frames adds to clone n's stock, the set made by the clone k generations back, both scored on the same 200 runs (SL.gain)
 *   smooth    the same set's value as the relative reduction of the copy error on clone n's own frames, with the share of the set's frames beyond 4 cm from the path (SL.cell, SL.step)
 *   clone     each clone's own success and share of runs that end in a post (1000 runs of the lineage's stream)
 *   drift     clone 1 (the demonstrations alone): a set made at gust i, the retrained policy run at gust j: success points (SL.driftGain) and the smooth value
 *   reach     where the clones' frames lie against the first clone's: 99th-percentile distance from the path, share beyond the first clone's reach, share within one bandwidth of one set
 *   side      a sideways retraining: corrections made for another clone of other demonstrations against corrections made for the clone itself (SL.sideGain)
 *   disc      what is lost by dropping the calm demonstrations, or all rounds but the newest or the oldest
 * Four lineages (SL.LIN) are pooled; every number is a function of fixed seeds, the file has no Math.random and no Date.
 */
'use strict';
const fs = require('fs'), path = require('path'), cp = require('child_process');
const ROOT = path.resolve(__dirname, '../../../..');
const DD = path.join(ROOT, 'all_lessons', fs.existsSync(path.join(ROOT, 'all_lessons', 'robot_model_training_new')) ? 'robot_model_training_new' : 'robot_model_training');
const SHELF = path.join(DD, 'shelf_lab.js');
const SL = require(SHELF), DL = require(path.join(DD, 'dagger_lab.js'));
const LG = require(path.join(DD, 'ledger.js'));
const CHECK = process.argv.includes('--check');
const t0 = Date.now(), lap = (m) => console.error(m, ((Date.now() - t0) / 1000).toFixed(0) + ' s');
const round = (x, d) => Math.round(x * Math.pow(10, d)) / Math.pow(10, d);

/* ───────────────────────── one worker: everything that belongs to one lineage, the drift of one gust, or the sideways retraining ───────────────────────── */
function lineWork(L) {
  let lin = SL.lineage(L), R = { gain: {}, post: {}, red: {}, far: {}, dev: {}, cov: {}, disc: {}, frames: [] }, F = lin.F, i, n, k, d;
  for (i = 0; i < 5; i++) R.frames.push(F[i + 1] - F[i]);
  for (n = 1; n <= 6; n++) for (d = 0; d < SL.NGAIN[n]; d++) {
    const base = SL.success(SL.clone(lin, n), SL.NEV, SL.GUSTS[0], SL.evalSeed(L, n - 1, d)).succ;
    SL.KS[n].forEach((kk) => { (R.gain[n + '|' + kk] = R.gain[n + '|' + kk] || []).push(SL.gain(lin, n, kk, d, base)); });
  }
  for (n = 1; n <= 6; n++) { const e = SL.success(SL.clone(lin, n), SL.NPOST, SL.GUSTS[0], SL.postSeed(L)); R.post[n] = { succ: e.succ, coll: e.coll }; }
  for (n = 1; n <= 6; n++) for (k = 0; k < n; k++) { const c = SL.run(SL.cell(lin, n, k, 0, 0)); R.red[n + '|' + k] = c.red.slice(); R.far[n + '|' + k] = c.far.slice(); }
  for (let gi = 0; gi < 3; gi++) for (let gj = 0; gj < 3; gj++) if (gi || gj) R.red['d|' + gi + '|' + gj] = SL.run(SL.cell(lin, 1, 0, gi, gj)).red.slice();
  const set0 = SL.nwOf(SL.draw(SL.clone(lin, 1), 33000 + 100000 * L, SL.GUSTS[0])), rows = [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0], [5, 0], [0, 1], [0, 2]];
  rows.forEach((row) => {
    const g = row[0], gi = row[1], runs = SL.runs(SL.clone(lin, g + 1), 100, SL.refSeed(L, g, gi), SL.GUSTS[gi]), key = g + '|' + gi, dv = []; let hit = 0, tot = 0;
    runs.forEach((ro) => ro.S.forEach((q) => { dv.push(round(SL.dev(q), 4)); tot++; if (DL.dist(set0, q) < 1) hit++; }));
    R.dev[key] = dv; R.cov[key] = [hit, tot];
  });
  const ev = (fr) => SL.success(SL.nwOf(fr), SL.NPOST, SL.GUSTS[0], SL.postSeed(L)).succ, all = lin.all, D = all.slice(0, F[0]);
  for (n = 3; n <= 6; n++) R.disc[n + '|noD'] = ev(all.slice(F[0], F[n - 1]));
  R.disc['5|newest'] = ev(D.concat(all.slice(F[3], F[4]))); R.disc['5|oldest'] = ev(all.slice(0, F[1]));
  return R;
}
function driftWork(gj) {
  const lin = SL.lineage(SL.LIN[0]), out = {};
  for (let d = 0; d < SL.NDRIFT; d++) {
    const base = SL.success(SL.clone(lin, 1), SL.NEV, SL.GUSTS[gj], SL.driftEval(gj, d)).succ;
    for (let gi = 0; gi < 3; gi++) (out[gi + '|' + gj] = out[gi + '|' + gj] || []).push(SL.driftGain(gi, gj, d, base));
  }
  return out;
}
function sideWork() {
  const out = {};
  for (let pi = 0; pi < SL.PAIRS.length; pi++) for (let d = 0; d < SL.NSIDE; d++) { const g = SL.sideGain(pi, d); (out[pi + '|stale'] = out[pi + '|stale'] || []).push(g.stale); (out[pi + '|fresh'] = out[pi + '|fresh'] || []).push(g.fresh); }
  return out;
}
if (process.argv[2] === '--worker') {
  const kind = process.argv[3], arg = +process.argv[4];
  const out = kind === 'line' ? lineWork(arg) : kind === 'drift' ? driftWork(arg) : sideWork();
  process.stdout.write(JSON.stringify(out) + '\n', () => process.exit(0));
  return;
}

/* ───────────────────────── reduce the raw draws to the compact table ───────────────────────── */
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const sd = (a) => { const m = mean(a); return Math.sqrt(a.reduce((x, y) => x + (y - m) * (y - m), 0) / Math.max(1, a.length - 1)); };
const se = (a) => sd(a) / Math.sqrt(a.length);
const ratio = (num, den) => ({ r: mean(num) / mean(den), se: Math.sqrt((se(num) / mean(den)) ** 2 + (mean(num) * se(den) / mean(den) ** 2) ** 2) });
const corr = (x, y) => { const mx = mean(x), my = mean(y); let sxy = 0, sxx = 0, syy = 0; for (let i = 0; i < x.length; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; syy += (y[i] - my) ** 2; } return sxy / Math.sqrt(sxx * syy); };
const quant = (a, p) => { const b = Float64Array.from(a).sort(); return b[Math.min(b.length - 1, Math.floor(p * b.length))]; };
const pct = (a) => a.map((x) => 100 * x);

function reduce(res) {
  let LIN = SL.LIN, pool = (field, key) => [].concat(...LIN.map((L) => res.line[L][field][key])), T = { gen: [0, 1, 2, 3, 4, 5] }, i, j;
  T.lineages = LIN.length; T.draws = { gain: SL.NGAIN, set: SL.NDRAW, drift: SL.NDRIFT, side: SL.NSIDE, runsPerClone: SL.NPOST, evalRuns: SL.NEV, setFrames: SL.NSET, probeRuns: SL.NPROBE };
  const G = {}; T.gain = {};
  for (let n = 1; n <= 6; n++) SL.KS[n].forEach((k) => { const a = pct(pool('gain', n + '|' + k)); G[n + '|' + k] = a; T.gain[n + '|' + k] = { m: mean(a), se: se(a), n: a.length }; });
  for (let n = 2; n <= 4; n++) SL.KS[n].forEach((k) => { if (k) { const q = ratio(G[n + '|' + k], G[n + '|0']); T.gain[n + '|' + k].r = q.r; T.gain[n + '|' + k].rse = q.se; } });
  T.clone = { succ: [], post: [], n: SL.NPOST * LIN.length };
  for (let n = 1; n <= 6; n++) { T.clone.succ.push(100 * mean(LIN.map((L) => res.line[L].post[n].succ))); T.clone.post.push(100 * mean(LIN.map((L) => res.line[L].post[n].coll))); }
  const RED = {}, FAR = {}; T.smooth = {};
  for (let n = 1; n <= 6; n++) for (let k = 0; k < n; k++) {
    const key = n + '|' + k; RED[key] = pool('red', key); FAR[key] = pool('far', key);
    T.smooth[key] = { m: 100 * mean(RED[key]), se: 100 * se(RED[key]), far: 100 * mean(FAR[key]), n: RED[key].length };
  }
  for (let n = 2; n <= 6; n++) for (let k = 1; k < n; k++) { const q = ratio(RED[n + '|' + k], RED[n + '|0']); T.smooth[n + '|' + k].r = q.r; T.smooth[n + '|' + k].rse = q.se; }
  T.corr = {}; for (let n = 2; n <= 6; n++) { const xs = [], ys = []; for (let k = 0; k < n; k++) { xs.push(...FAR[n + '|' + k]); ys.push(...RED[n + '|' + k]); } T.corr[n] = corr(xs, ys); }
  T.drift = {}; T.driftSmooth = {};
  const DR = {}; for (i = 0; i < 3; i++) for (j = 0; j < 3; j++) DR[i + '|' + j] = pct(res.drift[i + '|' + j]);
  const redD = (a, b) => (a === 0 && b === 0) ? RED['1|0'] : pool('red', 'd|' + a + '|' + b);
  for (i = 0; i < 3; i++) for (j = 0; j < 3; j++) {
    const q = ratio(DR[i + '|' + j], DR[j + '|' + j]), s = ratio(redD(i, j), redD(j, j));
    T.drift[i + '|' + j] = { m: mean(DR[i + '|' + j]), se: se(DR[i + '|' + j]), r: q.r, rse: q.se, n: DR[i + '|' + j].length };
    T.driftSmooth[i + '|' + j] = { m: 100 * mean(redD(i, j)), r: s.r, rse: s.se };
  }
  const st = pct(res.side['0|stale'].concat(res.side['1|stale'])), fr = pct(res.side['0|fresh'].concat(res.side['1|fresh'])), sq = ratio(st, fr);
  T.side = { stale: mean(st), fresh: mean(fr), r: sq.r, rse: sq.se, n: st.length };
  const DEV = {}, rows = { c1: '0|0', c2: '1|0', c3: '2|0', c4: '3|0', c5: '4|0', c6: '5|0', g1: '0|1', g2: '0|2' }; T.reach = {};
  Object.keys(rows).forEach((name) => { DEV[name] = pool('dev', rows[name]); });
  const R0 = quant(DEV.c1, 0.99);
  Object.keys(rows).forEach((name) => {
    const d = DEV[name], c = LIN.reduce((a, L) => [a[0] + res.line[L].cov[rows[name]][0], a[1] + res.line[L].cov[rows[name]][1]], [0, 0]);
    T.reach[name] = { p99: quant(d, 0.99), over: 100 * d.filter((x) => x > R0).length / d.length, cover: 100 * c[0] / c[1], n: d.length };
  });
  T.reach.R0 = R0;
  T.disc = {}; ['3|noD', '4|noD', '5|noD', '6|noD', '5|newest', '5|oldest'].forEach((key) => { T.disc[key] = 100 * mean(LIN.map((L) => res.line[L].disc[key])); });
  T.framesPerRound = mean([].concat(...LIN.map((L) => res.line[L].frames)));
  T.successByGen = T.clone.succ; T.postsByGen = T.clone.post;
  T.valueByGen = T.gen.map((g) => T.gain[(g + 1) + '|0'].m);
  T.valueSe = T.gen.map((g) => T.gain[(g + 1) + '|0'].se);
  /* the share of a correction's value that survives a retraining of the policy it was made for, by the age of the set (age 0 = a fresh set = 1) */
  T.keepSuccess = T.gen.map((k) => { if (k === 0) return 1; let a = 0, b = 0, c = 0; for (let n = 2; n <= 4; n++) if (k < n) { a += T.gain[n + '|' + k].m; b += T.gain[n + '|0'].m; c++; } return c ? a / b : null; });
  T.keepSmooth = T.gen.map((k) => { if (k === 0) return 1; let a = 0, c = 0; for (let n = 2; n <= 6; n++) if (k < n) { a += T.smooth[n + '|' + k].r; c++; } return c ? a / c : null; });
  T.driftKeep = { ratio: [1, 1.5, 2], keep: [1, T.drift['0|1'].r, T.drift['0|2'].r], keepSmooth: [1, T.driftSmooth['0|1'].r, T.driftSmooth['0|2'].r], harsher: [T.drift['1|0'].r, T.drift['2|0'].r] };
  T.notes = {
    gen: 'rounds already stored: 0 is the clone of the 20 calm demonstrations (clone 1 on the page), g is clone g + 1',
    keep: 'share of a correction set\'s value that survives a retraining of the policy it was made for, as the ledger should book it: 1 (no decay was measured); keepSuccess[k] and keepSmooth[k] are the measured ratios by age k of the set, in clones',
    keepSuccess: 'age k = 1..3: pooled gain of sets made k clones back divided by the pooled gain of fresh sets, clones 2 to 4 (success points, same 200 runs for base and retrained policy); null where not measured (success saturates from clone 4 on)',
    keepSmooth: 'age k = 1..5: mean over the clones that have a set of that age of the ratio of the relative copy-error reductions on the clone\'s own frames; it rises with age, from 0.9 to 3.3 across cells',
    valueByGen: 'success points that a fresh set of 800 labelled frames (the first 800 frames of eight runs of the clone itself, gust 0.05) adds to the clone of that generation; 4 lineages, pooled draws',
    postsByGen: 'percent of the clone\'s own runs under gust 0.05 that end in a post (a failure; none times out); 4 x 1000 runs',
    successByGen: 'percent of the clone\'s runs under gust 0.05 that complete the course',
    driftKeep: 'value of a set made at gust ratio x 0.05 for the clone of the demonstrations, used by a policy that runs at gust 0.05 (ratio 1) / 0.075 / 0.10, relative to a set made at the gust the policy runs at; success points over 100 draws (keep) and copy-error measure (keepSmooth); harsher: sets made at 0.075 and 0.10, used at 0.05',
    framesPerRound: 'labelled frames per round of five runs, mean of the four lineages (one frame is 0.05 s of motion)',
    dropDemos: 'once at least two rounds are stored, success of the clone trained on the corrections alone (roundsOnlyByGen, gen 2 to 5) is higher than that of the clone trained on the 20 calm demonstrations plus the rounds (successByGen): the ledger\'s recover.corr curve understates what corrections alone reach',
    scale: 'the Bench task is small: shapes, signs and ratios carry to larger tasks; the totals, the gains in points and the dollar figures do not'
  };
  return T;
}

/* ───────────────────────── write and check ───────────────────────── */
function compact(x) {
  if (Array.isArray(x)) return x.map(compact);
  if (x && typeof x === 'object') { const o = {}; Object.keys(x).forEach((k) => { o[k] = compact(x[k]); }); return o; }
  return typeof x === 'number' && isFinite(x) && !Number.isInteger(x) ? round(x, 4) : x;
}
const BEGIN = '/*TABLE:BEGIN*/', END = '/*TABLE:END*/';
function writeTable(T) {
  const src = fs.readFileSync(SHELF, 'utf8'), a = src.indexOf(BEGIN), b = src.indexOf(END);
  if (a < 0 || b < 0) throw new Error('shelf_lab.js has no TABLE markers');
  fs.writeFileSync(SHELF, src.slice(0, a + BEGIN.length) + '\nSL.TABLE = ' + JSON.stringify(compact(T)) + ';\n' + src.slice(b));
}
function spawnWorker(args) {
  return new Promise((resolve, reject) => {
    const ch = cp.spawn(process.execPath, [__filename, '--worker'].concat(args), { stdio: ['ignore', 'pipe', 'inherit'], maxBuffer: 1 << 30 }), chunks = [];
    ch.stdout.on('data', (b) => chunks.push(b)); ch.on('error', reject);
    ch.on('close', (code) => { if (code !== 0) return reject(new Error('worker ' + args.join(' ') + ' exited with ' + code)); try { lap('worker ' + args.join(' ') + ' done'); resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch (e) { reject(e); } });
  });
}
function build() {
  const jobs = SL.LIN.map((L) => ['line', String(L)]).concat([['drift', '0'], ['drift', '1'], ['drift', '2'], ['side']]);
  return Promise.all(jobs.map(spawnWorker)).then((r) => {
    const res = { line: {}, drift: Object.assign({}, r[SL.LIN.length], r[SL.LIN.length + 1], r[SL.LIN.length + 2]), side: r[SL.LIN.length + 3] };
    SL.LIN.forEach((L, i) => { res.line[L] = r[i]; });
    return reduce(res);
  });
}
function check() {                                                       // live recomputation of the cheap cells against the stored table
  const T = SL.TABLE, bad = [];
  if (!T) { console.log('SHELF CHECK FAILED: no stored table'); process.exit(1); }
  const eq = (a, b, tol, what) => { if (!(Math.abs(a - b) <= tol)) bad.push(what + ': table ' + b + ', live ' + a); };
  const pool = [];
  SL.LIN.forEach((L) => { const lin = SL.lineage(L); for (let n = 1; n <= 6; n++) for (let k = 0; k < n; k++) { const c = SL.run(SL.cell(lin, n, k, 0, 0)); (pool[n + '|' + k] = pool[n + '|' + k] || []).push(...c.red); } });
  for (let n = 1; n <= 6; n++) for (let k = 0; k < n; k++) eq(100 * mean(pool[n + '|' + k]), T.smooth[n + '|' + k].m, 6e-5, 'smooth ' + n + '|' + k);
  for (let n = 1; n <= 6; n++) { let s = 0, c = 0; SL.LIN.forEach((L) => { const e = SL.success(SL.clone(SL.lineage(L), n), SL.NPOST, SL.GUSTS[0], SL.postSeed(L)); s += e.succ; c += e.coll; }); eq(100 * s / SL.LIN.length, T.clone.succ[n - 1], 6e-5, 'clone ' + n + ' success'); eq(100 * c / SL.LIN.length, T.clone.post[n - 1], 6e-5, 'clone ' + n + ' posts'); }
  const g = []; SL.LIN.forEach((L) => { const lin = SL.lineage(L); for (let d = 0; d < SL.NGAIN[6]; d++) g.push(100 * SL.gain(lin, 6, 0, d)); });
  eq(mean(g), T.gain['6|0'].m, 6e-5, 'gain 6|0');
  if (bad.length) { console.log('SHELF CHECK FAILED\n' + bad.join('\n')); process.exit(1); }
  console.log('shelf check: sample cells agree with the stored table');
}
if (CHECK) check();
else build().then((T) => { writeTable(T); console.log('table written to ' + path.relative(ROOT, SHELF) + ' in ' + ((Date.now() - t0) / 1000).toFixed(0) + ' s, ' + JSON.stringify(compact(T)).length + ' bytes'); }).catch((e) => { console.error(e && e.stack || e); process.exit(2); });
