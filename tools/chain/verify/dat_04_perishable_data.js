#!/usr/bin/env node
'use strict';
/* Oracle for embodied_training_data lesson 04 (is data perishable?  shelf life and the supply of corrections).
 * Re-derives every number the lesson quotes with code written separately from shelf_lab.js and dagger_lab.js: its own plant and rollout loop, its own kernel regressor (typed arrays,
 * its own grid, a different summation order), its own lineage of DAgger rounds (five runs a round, the expert labelling every visited state), its own sets, copy error, success
 * evaluation, reach and coverage, its own statistics.  Only the world's primitives (arm, expert, posts, collision, path) and the random stream come from bench.js.
 * Then it asserts the stored table of shelf_lab.js against its own numbers, the claims of the prose, and drives the page's widget through the states the prose names.
 * Development: DAT04_CACHE=/path/file.json reuses the raw measurements of an earlier run (delete the file after changing any experiment), DAT04_SERIAL=1 runs the workers one after the other.
 * Last stdout line: {"facts": {...}}. */
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '../../../all_lessons');
const dir = fs.existsSync(path.join(root, 'embodied_training_data_new')) ? 'embodied_training_data_new' : 'embodied_training_data';
const BN = require(path.join(root, dir, 'bench.js'));
const LG = require(path.join(root, dir, 'ledger.js'));
const SL = require(path.join(root, dir, 'shelf_lab.js'));            // only to read the stored table and to know what the page loads
const { loadPage } = require('../dom_probe.js');

let bad = 0;
const fail = (m) => { bad++; console.error('FAIL ' + m); };
const check = (c, m) => { if (!c) fail(m); };
const F = {};
const put = (k, v, d) => { F[k] = +(+v).toFixed(d === undefined ? 6 : d); };
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const sd = (a) => { const m = mean(a); return Math.sqrt(a.reduce((x, y) => x + (y - m) * (y - m), 0) / Math.max(1, a.length - 1)); };
const se = (a) => sd(a) / Math.sqrt(a.length);
const corr = (x, y) => { const mx = mean(x), my = mean(y); let sxy = 0, sxx = 0, syy = 0; for (let i = 0; i < x.length; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; syy += (y[i] - my) ** 2; } return sxy / Math.sqrt(sxx * syy); };
const quant = (a, p) => { const b = Float64Array.from(a).sort(); return b[Math.min(b.length - 1, Math.floor(p * b.length))]; };
/* ratio of two means with its standard error (delta method, as for any ratio of independent estimates) */
const ratio = (num, den) => { const r = mean(num) / mean(den); return { r, se: Math.sqrt((se(num) / mean(den)) ** 2 + (mean(num) * se(den) / mean(den) ** 2) ** 2) }; };

/* ───────────── the world, the plant and the rollout, written out ───────────── */
const W = BN.slalom.world(5, { s0: 1 }), T = BN.slalom.horizon(W), XE = BN.slalom.xEnd(W);
const DT = 0.05, JIT = 0.01, GUST = 0.05, H = 0.02, CELL = 3 * H;
const GUSTS = [0.05, 0.075, 0.10];
const clip = (u) => Math.max(-1.5, Math.min(1.5, u));
function rollout(pi, rng, noise) {                       // returns the visited states S, the commands A, and how it ended
  const q = BN.slalom.startQ(W, JIT * BN.randn(rng)).slice(), S = [], A = [];
  let coll = false, done = false;
  for (let t = 0; t < T; t++) {
    const p = BN.arm.fk(q, W.body); S.push([q[0], q[1]]);
    if (BN.slalom.collide(W, p)) { coll = true; break; }
    if (p[0] > XE - 0.02) { done = true; break; }
    const u = pi(q); A.push(u);
    const c0 = clip(u[0]), c1 = clip(u[1]), n0 = noise ? noise * BN.randn(rng) : 0, n1 = noise ? noise * BN.randn(rng) : 0;
    q[0] += DT * (c0 + n0); q[1] += DT * (c1 + n1);
  }
  return { S, A, coll, done };
}
const expert = (q) => BN.slalom.expertAct(W, q);
const devCm = (q) => { const p = BN.arm.fk(q, W.body); return Math.abs(p[1] - BN.slalom.yref(W, p[0])) * 100; };

/* ───────────── the nearest-demo policy: typed arrays, a hash grid of its own, cells visited in a different order from the engine's ───────────── */
function Store(frames) {
  const n = frames.length; this.n = n; this.X0 = new Float64Array(n); this.X1 = new Float64Array(n); this.Y0 = new Float64Array(n); this.Y1 = new Float64Array(n); this.g = new Map();
  for (let i = 0; i < n; i++) {
    this.X0[i] = frames[i][0][0]; this.X1[i] = frames[i][0][1]; this.Y0[i] = frames[i][1][0]; this.Y1[i] = frames[i][1][1];
    const key = Math.floor(this.X0[i] / CELL) * 4096 + Math.floor(this.X1[i] / CELL), a = this.g.get(key);
    if (a) a.push(i); else this.g.set(key, [i]);
  }
}
Store.prototype.predict = function (q) {
  const q0 = q[0], q1 = q[1], c0 = Math.floor(q0 / CELL), c1 = Math.floor(q1 / CELL);
  let sw = 0, a0 = 0, a1 = 0;
  for (let d1 = -1; d1 <= 1; d1++) for (let d0 = -1; d0 <= 1; d0++) {
    const a = this.g.get((c0 + d0) * 4096 + c1 + d1); if (!a) continue;
    for (let t = 0; t < a.length; t++) {
      const i = a[t], z0 = (this.X0[i] - q0) / H, z1 = (this.X1[i] - q1) / H, e = z0 * z0 + z1 * z1;
      if (e > 9) continue;
      const w = Math.exp(-0.5 * e); sw += w; a0 += w * this.Y0[i]; a1 += w * this.Y1[i];
    }
  }
  if (sw < 1e-12) { let best = Infinity, bi = 0; for (let i = 0; i < this.n; i++) { const z0 = (this.X0[i] - q0) / H, z1 = (this.X1[i] - q1) / H, e = z0 * z0 + z1 * z1; if (e < best) { best = e; bi = i; } } return [this.Y0[bi], this.Y1[bi]]; }
  return [a0 / sw, a1 / sw];
};
Store.prototype.dist = function (q) {                    // distance to the nearest stored frame in bandwidths, 3 when none lies within the kernel's reach
  const q0 = q[0], q1 = q[1], c0 = Math.floor(q0 / CELL), c1 = Math.floor(q1 / CELL);
  let best = Infinity;
  for (let d1 = -1; d1 <= 1; d1++) for (let d0 = -1; d0 <= 1; d0++) {
    const a = this.g.get((c0 + d0) * 4096 + c1 + d1); if (!a) continue;
    for (let t = 0; t < a.length; t++) { const i = a[t], z0 = (this.X0[i] - q0) / H, z1 = (this.X1[i] - q1) / H, e = z0 * z0 + z1 * z1; if (e < best) best = e; }
  }
  return best > 9 ? 3 : Math.sqrt(best);
};
const policy = (st) => (q) => st.predict(q);

/* ───────────── lineages: twenty calm demonstrations, then rounds of five runs of the latest clone, every visited state labelled by the expert ───────────── */
const lineCache = {};
function lineage(seed) {
  if (lineCache[seed]) return lineCache[seed];
  const all = [], Fr = [], rD = BN.rng(1);
  for (let k = 0; k < 20; k++) { const ro = rollout(expert, rD, 0); for (let t = 0; t < ro.A.length; t++) all.push([ro.S[t], ro.A[t]]); }
  Fr.push(all.length);
  const rng = BN.rng(100 + seed);
  for (let round = 1; round <= 5; round++) {
    const st = new Store(all.slice(0, Fr[round - 1])), fresh = [];
    for (let j = 0; j < 5; j++) { const ro = rollout(policy(st), rng, GUST); for (let t = 0; t < ro.S.length; t++) fresh.push([ro.S[t], expert(ro.S[t])]); }
    for (const f of fresh) all.push(f);
    Fr.push(all.length);
  }
  return (lineCache[seed] = { seed, all, F: Fr, clone: {} });
}
const stockOf = (L, n) => L.all.slice(0, L.F[n - 1]);
const cloneOf = (L, n) => L.clone[n] || (L.clone[n] = new Store(stockOf(L, n)));
function runs(st, count, seed, gust) { const rng = BN.rng(seed), out = []; for (let j = 0; j < count; j++) out.push(rollout(policy(st), rng, gust)); return out; }
function labelled(rs, limit) { const out = []; for (const ro of rs) for (let t = 0; t < ro.S.length && out.length < limit; t++) out.push([ro.S[t], expert(ro.S[t])]); return out; }
function setOf(st, seed, gust) { return labelled(runs(st, 8, seed, gust), 800); }
function evaluate(st, N, gust, seed) { const rng = BN.rng(seed); let ok = 0, co = 0; for (let k = 0; k < N; k++) { const ro = rollout(policy(st), rng, gust); if (ro.done) ok++; if (ro.coll) co++; } return { succ: ok / N, coll: co / N, tout: (N - ok - co) / N }; }
function copyErr(st, probe) { let e = 0, s = 0; for (const f of probe) { const p = st.predict(f[0]), a = f[1]; e += (p[0] - a[0]) ** 2 + (p[1] - a[1]) ** 2; s += a[0] * a[0] + a[1] * a[1]; } return Math.sqrt(e / s); }

/* the seeds of every experiment: one stream per use (the same numbers as the engine states, typed again here) */
const seedSet = (L, g, k, d, gi) => 55000 + 100000 * L + 1000 * g + 100 * k + d + 7000 * gi;
const seedProbe = (L, g, gi) => 123456 + g + 100 * L + 1000 * gi;
const seedRef = (L, g, gi) => 81000 + g + 100 * L + 1000 * gi;
const seedSucc = (L, g, k, d) => 9000 + 100000 * L + 1000 * g + 100 * k + d;
const seedDrift = (gc, d) => 91000 + 1000 * d + Math.round(gc * 10000);
const LIN = [8, 1, 2, 3], FAR = 4;


/* ───────────── the experiments (one task per lineage, so that they can run side by side) ───────────── */
const NSET = 800, NPROBE = 30, NDRAW = 10, NEV = 200, NPOST = 1000, NDRIFT = 100;
const NGAIN = { 1: 50, 2: 24, 3: 24, 4: 12, 5: 12, 6: 12 }, KS = { 1: [0], 2: [0, 1], 3: [0, 1, 2], 4: [0, 1, 2, 3], 5: [0], 6: [0] };
const seedEval = (L, g, d) => 3000 + 1000 * L + 100 * g + d, seedDriftEval = (gj, d) => 4000 + 100 * gj + d, seedPost = (L) => 2000 + L, seedCov = (L) => 33000 + 100000 * L;
const r4 = (x) => Math.round(x * 1e4) / 1e4;

function probeOf(L, n, gj) {                             // 30 runs of clone n at gust gj: its labelled frames, their distance from the path, and the error of its own stock on them
  L.probe = L.probe || {}; const key = n + '|' + gj; if (L.probe[key]) return L.probe[key];
  const st = cloneOf(L, n), fr = labelled(runs(st, NPROBE, seedProbe(L.seed, n - 1, gj), GUSTS[gj]), Infinity);
  return (L.probe[key] = { frames: fr, e0: copyErr(st, fr) });
}
function smoothCell(L, n, k, gi, gj) {                   // the value of ten sets made k clones back, as the share of the copy error they remove from clone n's own frames
  const pr = probeOf(L, n, gj), src = cloneOf(L, n - k), stock = stockOf(L, n), red = [], far = []; let cov0 = NaN;
  for (let d = 0; d < NDRAW; d++) {
    const X = setOf(src, seedSet(L.seed, n - 1, k, d, gi), GUSTS[gi]);
    if (d === 0) { const sx = new Store(X); let hit = 0; for (const f of pr.frames) if (sx.dist(f[0]) < 1) hit++; cov0 = hit / pr.frames.length; }   // coverage of the clone's frames by the first draw's set
    red.push((pr.e0 - copyErr(new Store(stock.concat(X)), pr.frames)) / pr.e0); far.push(X.filter((f) => devCm(f[0]) > FAR).length / X.length);
  }
  return { red, far, cov0 };
}
function lineTask(seed) {
  const L = lineage(seed), out = { gain: {}, post: {}, red: {}, far: {}, cov0: {}, dev: {}, cov: {}, disc: {}, frames: [], F: L.F.slice() };
  for (let j = 0; j < 5; j++) out.frames.push(L.F[j + 1] - L.F[j]);
  for (let n = 1; n <= 6; n++) {
    for (let d = 0; d < NGAIN[n]; d++) {            // success gains: the base and every retrained policy scored on the same 200 runs, a stream of its own per draw
      const sd_ = seedEval(seed, n - 1, d), base = evaluate(cloneOf(L, n), NEV, GUST, sd_).succ;
      for (const k of KS[n]) { const X = setOf(cloneOf(L, n - k), seedSucc(seed, n - 1, k, d), GUST); (out.gain[n + '|' + k] = out.gain[n + '|' + k] || []).push(evaluate(new Store(stockOf(L, n).concat(X)), NEV, GUST, sd_).succ - base); }
    }
    const e = evaluate(cloneOf(L, n), NPOST, GUST, seedPost(seed)); out.post[n] = { succ: e.succ, coll: e.coll, tout: e.tout };
    for (let k = 0; k < n; k++) { const c = smoothCell(L, n, k, 0, 0); out.red[n + '|' + k] = c.red; out.far[n + '|' + k] = c.far; out.cov0[n + '|' + k] = c.cov0; }
  }
  for (let gi = 0; gi < 3; gi++) for (let gj = 0; gj < 3; gj++) if (gi || gj) { const c = smoothCell(L, 1, 0, gi, gj); out.red['d|' + gi + '|' + gj] = c.red; out.far['d|' + gi + '|' + gj] = c.far; out.cov0['d|' + gi + '|' + gj] = c.cov0; }
  // reach, overreach and coverage: 100 runs of each clone (and of clone 1 under the harsher gusts), and a set from clone 1 at the gust of the course
  const set0 = new Store(setOf(cloneOf(L, 1), seedCov(seed), GUST)), rows = [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0], [5, 0], [0, 1], [0, 2]];
  for (const [g, gi] of rows) {
    const rs = runs(cloneOf(L, g + 1), 100, seedRef(seed, g, gi), GUSTS[gi]), dv = [], key = g + '|' + gi; let hit = 0, tot = 0;
    for (const ro of rs) for (const q of ro.S) { dv.push(r4(devCm(q))); tot++; if (set0.dist(q) < 1) hit++; }
    out.dev[key] = dv; out.cov[key] = [hit, tot];
  }
  // discarding, on the 1000 runs of the lineage's stream: demonstrations dropped (clones 3 to 6), only the newest or only the oldest round kept (clone 5)
  const D = L.all.slice(0, L.F[0]);
  for (let n = 3; n <= 6; n++) out.disc[n + '|noD'] = evaluate(new Store(L.all.slice(L.F[0], L.F[n - 1])), NPOST, GUST, seedPost(seed)).succ;
  out.disc['5|newest'] = evaluate(new Store(D.concat(L.all.slice(L.F[3], L.F[4]))), NPOST, GUST, seedPost(seed)).succ;
  out.disc['5|oldest'] = evaluate(new Store(L.all.slice(0, L.F[1])), NPOST, GUST, seedPost(seed)).succ;
  return out;
}
function driftTask(gj) {                                 // sets made at gust gi for clone 1, the retrained policy running at gust gj; each draw's base and policies on one stream
  const L = lineage(LIN[0]), st1 = cloneOf(L, 1), D = stockOf(L, 1), out = {};
  for (let d = 0; d < NDRIFT; d++) {
    const sd_ = seedDriftEval(gj, d), base = evaluate(st1, NEV, GUSTS[gj], sd_).succ;
    for (let gi = 0; gi < 3; gi++) { const X = setOf(st1, seedDrift(GUSTS[gi], d), GUSTS[gi]); (out[gi + '|' + gj] = out[gi + '|' + gj] || []).push(evaluate(new Store(D.concat(X)), NEV, GUSTS[gj], sd_).succ - base); }
  }
  return out;
}
function demoFrames(seed) {                              // twenty calm demonstrations of the expert from one stream, as (state, command) pairs
  const rng = BN.rng(seed), out = [];
  for (let k = 0; k < 20; k++) { const ro = rollout(expert, rng, 0); for (let t = 0; t < ro.A.length; t++) out.push([ro.S[t], ro.A[t]]); }
  return out;
}
function sideTask() {                                    // retrained from scratch on other demonstrations: corrections made for the clone of A against corrections made for the clone of B, both added to B
  const out = {};
  [[1, 2], [3, 4]].forEach(([a, b], pi) => {
    const A = demoFrames(a), B = demoFrames(b), stA = new Store(A), stB = new Store(B);
    for (let d = 0; d < 24; d++) {
      const sd_ = 5000 + 100 * pi + d, base = evaluate(stB, NEV, GUST, sd_).succ;
      const Xa = setOf(stA, 61000 + 1000 * pi + d, GUST), Xb = setOf(stB, 62000 + 1000 * pi + d, GUST);
      (out[pi + '|stale'] = out[pi + '|stale'] || []).push(evaluate(new Store(B.concat(Xa)), NEV, GUST, sd_).succ - base);
      (out[pi + '|fresh'] = out[pi + '|fresh'] || []).push(evaluate(new Store(B.concat(Xb)), NEV, GUST, sd_).succ - base);
    }
  });
  return out;
}

if (require.main !== module && !process.env.DAT04_LOAD) { /* required as a library (the scratch checks do this) */ }
const isMain = require.main === module;
if (isMain && process.argv[2] === '--worker') {
  const out = process.argv[3] === 'drift' ? driftTask(+process.argv[4]) : process.argv[3] === 'side' ? sideTask() : lineTask(+process.argv[4]);
  process.stdout.write(JSON.stringify(out) + '\n', () => process.exit(0));
  return;
}
module.exports = { lineTask, driftTask, sideTask, lineage, cloneOf, stockOf, probeOf, smoothCell, Store, runs, labelled, setOf, devCm, copyErr, quant, BN, LIN, GUSTS };
if (!isMain) return;

/* ───────────── run the tasks side by side (one process per lineage, one for the drift, one for the sideways retraining) ───────────── */
function compute() {
  const cacheFile = process.env.DAT04_CACHE;
  if (cacheFile && fs.existsSync(cacheFile)) return Promise.resolve(JSON.parse(fs.readFileSync(cacheFile, 'utf8')));
  const { spawn } = require('child_process');
  const jobs = LIN.map((L) => ['line', String(L)]).concat([['drift', '0'], ['drift', '1'], ['drift', '2'], ['side']]);
  const run1 = (job) => new Promise((resolve, reject) => {
    const ch = spawn(process.execPath, [__filename, '--worker'].concat(job), { stdio: ['ignore', 'pipe', 'inherit'], maxBuffer: 1 << 30 }), chunks = [];
    ch.stdout.on('data', (b) => chunks.push(b)); ch.on('error', reject);
    ch.on('close', (code) => { if (code !== 0) return reject(new Error('worker ' + job.join(' ') + ' exited with ' + code)); try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch (e) { reject(e); } });
  });
  const serial = process.env.DAT04_SERIAL === '1';
  const go = serial ? jobs.reduce((p, j) => p.then((acc) => { const o = j[0] === 'drift' ? driftTask(+j[1]) : j[0] === 'side' ? sideTask() : lineTask(+j[1]); acc.push(o); return acc; }), Promise.resolve([])) : Promise.all(jobs.map(run1));
  return go.then((r) => { const res = { line: {}, drift: Object.assign({}, r[LIN.length], r[LIN.length + 1], r[LIN.length + 2]), side: r[LIN.length + 3] }; LIN.forEach((L, i) => { res.line[L] = r[i]; }); if (cacheFile) fs.writeFileSync(cacheFile, JSON.stringify(res)); return res; });
}

compute().then(main).catch((e) => { console.error(e && e.stack || e); process.exit(2); });

function main(res) {
  const pool = (field, key) => [].concat(...LIN.map((L) => res.line[L][field][key]));
  const pct = (a) => a.map((x) => x * 100);
  /* success gains: points a set adds, scored on the same 200 runs as its base */
  const G = {};
  for (let n = 1; n <= 6; n++) for (const k of KS[n]) { G[n + '|' + k] = pct(pool('gain', n + '|' + k)); put('g' + n + '_' + k, mean(G[n + '|' + k]), 3); put('gs' + n + '_' + k, se(G[n + '|' + k]), 3); }
  for (let n = 1; n <= 6; n++) put('gn' + n, G[n + '|0'].length, 0);
  for (let n = 2; n <= 4; n++) for (const k of KS[n]) if (k) { const q = ratio(G[n + '|' + k], G[n + '|0']); put('rs' + n + '_' + k, q.r, 3); put('rss' + n + '_' + k, q.se, 3); }
  /* sideways: the clone is replaced, trained from scratch on other demonstrations */
  { const st = res.side['0|stale'].concat(res.side['1|stale']), fr = res.side['0|fresh'].concat(res.side['1|fresh']), q = ratio(pct(st), pct(fr));
    put('side_stale', mean(pct(st)), 3); put('side_fresh', mean(pct(fr)), 3); put('side_r', q.r, 3); put('side_rse', q.se, 3); put('side_n', st.length, 0);
    for (let pi = 0; pi < 2; pi++) { const a = ratio(pct(res.side[pi + '|stale']), pct(res.side[pi + '|fresh'])); put('side_r' + pi, a.r, 3); put('side_rse' + pi, a.se, 3); } }
  /* each clone's own success and failure share (1000 runs of each lineage's stream) */
  for (let n = 1; n <= 6; n++) { put('su' + n, 100 * mean(LIN.map((L) => res.line[L].post[n].succ)), 3); put('po' + n, 100 * mean(LIN.map((L) => res.line[L].post[n].coll)), 3); put('to' + n, 100 * mean(LIN.map((L) => res.line[L].post[n].tout)), 3);
    put('f5_' + n, 5 * F['po' + n] / 100, 3); put('none5_' + n, 100 * Math.pow(1 - F['po' + n] / 100, 5), 3); }
  /* smooth relevance: the share of the copy error a set removes from clone n's own frames */
  const RED = {}, FAR = {};
  for (let n = 1; n <= 6; n++) for (let k = 0; k < n; k++) { RED[n + '|' + k] = pool('red', n + '|' + k); FAR[n + '|' + k] = pool('far', n + '|' + k); }
  for (let n = 1; n <= 6; n++) { put('fe' + n, 100 * mean(RED[n + '|0']), 4); put('fes' + n, 100 * se(RED[n + '|0']), 4);
    for (let k = 0; k < n; k++) { put('far' + n + '_' + k, 100 * mean(FAR[n + '|' + k]), 3); if (k) { const q = ratio(RED[n + '|' + k], RED[n + '|0']); put('r' + n + '_' + k, q.r, 4); put('rse' + n + '_' + k, q.se, 4); } } }
  for (let n = 2; n <= 6; n++) { const xs = [], ys = []; for (let k = 0; k < n; k++) { xs.push(...FAR[n + '|' + k]); ys.push(...RED[n + '|' + k]); } put('corr' + n, corr(xs, ys), 4); put('corrn' + n, xs.length, 0); }
  /* the world moves: success by clone 1 (D alone), 24 draws, each draw's base and policies on one stream */
  const DR = {}; for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) DR[i + '|' + j] = pct(res.drift[i + '|' + j]);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) { put('dg' + i + j, mean(DR[i + '|' + j]), 3); put('dgs' + i + j, se(DR[i + '|' + j]), 3); const q = ratio(DR[i + '|' + j], DR[j + '|' + j]); put('dr' + i + j, q.r, 4); put('drs' + i + j, q.se, 4); }
  const redD = (i, j) => (i === 0 && j === 0) ? RED['1|0'] : pool('red', 'd|' + i + '|' + j);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) { put('dv' + i + j, 100 * mean(redD(i, j)), 4); put('ds' + i + j, ratio(redD(i, j), redD(j, j)).r, 4); put('dss' + i + j, ratio(redD(i, j), redD(j, j)).se, 4); }
  /* reach, overreach, coverage */
  const DEV = {}, COV = {}; for (const key of ['0|0', '1|0', '2|0', '3|0', '4|0', '5|0', '0|1', '0|2']) { DEV[key] = pool('dev', key); COV[key] = LIN.reduce((a, L) => [a[0] + res.line[L].cov[key][0], a[1] + res.line[L].cov[key][1]], [0, 0]); }
  const R0 = quant(DEV['0|0'], 0.99); put('r0cm', R0, 4);
  const rows = { c1: '0|0', c2: '1|0', c3: '2|0', c4: '3|0', c5: '4|0', c6: '5|0', g1: '0|1', g2: '0|2' };
  for (const [name, key] of Object.entries(rows)) { const d = DEV[key]; put('rc_' + name, quant(d, 0.99), 4); put('ov_' + name, 100 * d.filter((x) => x > R0).length / d.length, 4); put('cv_' + name, 100 * COV[key][0] / COV[key][1], 3); put('nf_' + name, d.length, 0); }
  /* discarding */
  for (const key of ['3|noD', '4|noD', '5|noD', '6|noD', '5|newest', '5|oldest']) put('d_' + key.replace('|', '_'), 100 * mean(LIN.map((L) => res.line[L].disc[key])), 3);
  /* the stock, the price, the arithmetic */
  put('fpr', mean([].concat(...LIN.map((L) => res.line[L].frames))), 3); put('fpr_s', F.fpr * DT, 3);
  const A = LG.assume, pCorr = (A.wage_per_h + A.arm_cost / A.arm_life_h) / A.sup_duty;      // lesson 2's price of an hour of corrections, from its assumptions
  check(Math.abs(pCorr - LG.price('corr')) < 1e-9, 'LG.price(corr) is (wage + arm per hour) / supervision duty');
  put('p_corr', pCorr, 4); put('set_s', NSET * DT, 3); put('set_cost', NSET * DT / 3600 * pCorr, 4);
  const stock = (rho) => 1 + rho + rho * rho + rho * rho * rho;
  put('stock80', stock(0.8), 4); put('stock50', stock(0.5), 4); put('lk80', 100 * (1 - F.stock80 / 4), 3); put('lk50', 100 * (1 - F.stock50 / 4), 3);
  const cells = []; for (let n = 2; n <= 6; n++) for (let k = 1; k < n; k++) cells.push([n, k]);
  const rOf = ([n, k]) => F['r' + n + '_' + k], seOf = ([n, k]) => F['rse' + n + '_' + k], low = cells.reduce((a, c) => rOf(c) < rOf(a) ? c : a, cells[0]);
  put('rmin', rOf(low), 4); put('rmin_se', seOf(low), 4); put('rse_lo', Math.min(...cells.map(seOf)), 4); put('rse_hi', Math.max(...cells.map(seOf)), 4);
  put('keep_s1', mean([2, 3, 4, 5, 6].map((n) => F['r' + n + '_1'])), 4);
  put('z43', (F.r4_3 - Math.pow(0.8, 3)) / F.rse4_3, 3); put('z43b', (F.r4_3 - Math.pow(0.95, 3)) / F.rse4_3, 3);
  put('inv4', 100 / F.po4, 3); put('inv5', 100 / F.po5, 3);
  put('loss15', 100 * (1 - F.dr01), 3); put('loss2', 100 * (1 - F.dr02), 3); put('rent2', (1 - F.dr02) * F.set_cost, 4);
  for (let gi = 0; gi < 3; gi++) put('far_g' + gi, 100 * mean(pool('far', gi === 0 ? '1|0' : 'd|' + gi + '|0')), 3);
  for (let n = 1; n <= 6; n++) put('ppd' + n, F['g' + n + '_0'] / F.set_cost, 3);
  put('ppd_ratio', F.ppd1 / F.ppd4, 3);
  put('sat_video', 100 * LG.TABLE.layouts.src.video.s[8].slice(-1)[0], 3); put('sat_s1', 100 * LG.TABLE.layouts.src['sim0.01'].s[8].slice(-1)[0], 3);
  put('lose_new', F.su5 - F.d_5_newest, 3); put('lose_old', F.su5 - F.d_5_oldest, 3);
  for (let n = 3; n <= 6; n++) { put('wd' + n, F['su' + n], 3); put('nd' + n, F['d_' + n + '_noD'], 3); put('dd' + n, F['d_' + n + '_noD'] - F['su' + n], 3); }
  put('po4f', F.po4 / 100, 5);
  put('ck_a', 100 / F.po4, 3); put('ck_a2', F.ck_a / 5, 3); put('ck_b', F.none5_4, 3); put('ck_c4n', 5 * F.po4 / 100, 5); put('ck_c4', F.set_cost / F.ck_c4n, 3); put('ck_c1n', 5 * F.po1 / 100, 5); put('ck_c1', F.set_cost / F.ck_c1n, 3); put('ck_c', F.ck_c4 / F.ck_c1, 3);

  /* ───── the engine's constants and lineages are the ones this file re-typed ───── */
  check(SL.NSET === NSET && SL.NRUN === 8 && SL.NDRAW === NDRAW && SL.NPROBE === NPROBE && SL.NEV === NEV && SL.NPOST === NPOST && SL.NDRIFT === NDRIFT && SL.NSIDE === 24 && SL.NCLONE === 6, 'engine constants differ from the oracle\'s');
  check(JSON.stringify(SL.NGAIN) === JSON.stringify(NGAIN) && JSON.stringify(SL.KS) === JSON.stringify(KS) && JSON.stringify(SL.LIN) === JSON.stringify(LIN) && JSON.stringify(SL.GUSTS) === JSON.stringify(GUSTS) && SL.FAR === 4, 'engine draw counts, ages, lineages or gusts differ from the oracle\'s');
  for (const L of LIN) { const lin = SL.lineage(L); check(JSON.stringify(lin.F) === JSON.stringify(res.line[L].F), `lineage ${L}: the engine's stock sizes ${lin.F} differ from the independent lineage's ${res.line[L].F}`); }
  check(JSON.stringify(LG.TABLE.recover.corr.frames.slice(0, 6)) === JSON.stringify(res.line[8].F), 'the ledger\'s corrections curve is not the lineage this lesson calls seed 8');

  /* ───── the stored table of shelf_lab.js against these numbers ───── */
  const TB = SL.TABLE;
  check(!!TB, 'shelf_lab.js has no stored table');
  if (TB) {
    const near = (a, b, tol, what) => { if (!(Math.abs(a - b) <= tol)) fail(`stored table: ${what} is ${a}, the independent computation gives ${b}`); };
    const T0 = 6e-5, ps = (a) => a;
    for (let n = 1; n <= 6; n++) for (let k = 0; k < n; k++) {
      const key = n + '|' + k, t = TB.smooth[key];
      near(t.m, 100 * mean(RED[key]), T0, `smooth ${key} value`); near(t.se, 100 * se(RED[key]), T0, `smooth ${key} s.e.`); near(t.far, 100 * mean(FAR[key]), T0, `smooth ${key} far share`); near(t.n, RED[key].length, 0, `smooth ${key} draws`);
      if (k) { const q = ratio(RED[key], RED[n + '|0']); near(t.r, q.r, T0, `smooth ${key} relevance`); near(t.rse, q.se, T0, `smooth ${key} relevance s.e.`); }
    }
    for (let n = 1; n <= 6; n++) for (const k of KS[n]) {
      const key = n + '|' + k, t = TB.gain[key]; near(t.m, mean(G[key]), T0, `gain ${key}`); near(t.se, se(G[key]), T0, `gain ${key} s.e.`); near(t.n, G[key].length, 0, `gain ${key} draws`);
      if (k) { const q = ratio(G[key], G[n + '|0']); near(t.r, q.r, T0, `gain ${key} relevance`); near(t.rse, q.se, T0, `gain ${key} relevance s.e.`); }
    }
    for (let n = 1; n <= 6; n++) { near(TB.clone.succ[n - 1], F['su' + n], 1e-3, `success of clone ${n}`); near(TB.clone.post[n - 1], F['po' + n], 1e-3, `posts of clone ${n}`); near(TB.successByGen[n - 1], F['su' + n], 1e-3, `successByGen ${n}`); near(TB.postsByGen[n - 1], F['po' + n], 1e-3, `postsByGen ${n}`); near(TB.valueByGen[n - 1], mean(G[n + '|0']), T0, `valueByGen ${n}`); near(TB.valueSe[n - 1], se(G[n + '|0']), T0, `valueSe ${n}`); }
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
      const k = i + '|' + j, d = TB.drift[k], q = ratio(DR[k], DR[j + '|' + j]), a = TB.driftSmooth[k], sq = ratio(redD(i, j), redD(j, j));
      near(d.m, mean(DR[k]), T0, `drift ${k} gain`); near(d.se, se(DR[k]), T0, `drift ${k} s.e.`); near(d.r, q.r, T0, `drift ${k} relevance`); near(d.rse, q.se, T0, `drift ${k} relevance s.e.`);
      near(a.m, 100 * mean(redD(i, j)), T0, `smooth drift ${k} value`); near(a.r, sq.r, T0, `smooth drift ${k} relevance`); near(a.rse, sq.se, T0, `smooth drift ${k} relevance s.e.`);
    }
    { const st = [].concat(...[0, 1].map((pi) => pct(res.side[pi + '|stale']))), fr = [].concat(...[0, 1].map((pi) => pct(res.side[pi + '|fresh']))), q = ratio(st, fr);
      near(TB.side.stale, mean(st), T0, 'side stale'); near(TB.side.fresh, mean(fr), T0, 'side fresh'); near(TB.side.r, q.r, T0, 'side relevance'); near(TB.side.rse, q.se, T0, 'side relevance s.e.'); near(TB.side.n, st.length, 0, 'side draws'); }
    for (const name of ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'g1', 'g2']) { const t = TB.reach[name]; near(t.p99, F['rc_' + name], 1e-4, `reach ${name}`); near(t.over, F['ov_' + name], 1e-3, `overreach ${name}`); near(t.cover, F['cv_' + name], 1e-3, `coverage ${name}`); near(t.n, F['nf_' + name], 0, `frames ${name}`); }
    near(TB.reach.R0, R0, 1e-4, 'reach of clone 1');
    for (const key of ['3|noD', '4|noD', '5|noD', '6|noD', '5|newest', '5|oldest']) near(TB.disc[key], F['d_' + key.replace('|', '_')], 1e-3, 'discard ' + key);
    for (let n = 2; n <= 6; n++) near(TB.corr[n], F['corr' + n], 1e-4, `correlation at clone ${n}`);
    near(TB.framesPerRound, F.fpr, 1e-3, 'frames per round');
    const kS = [0, 1, 2, 3, 4, 5].map((k) => { if (k === 0) return 1; let a = 0, b = 0, c = 0; for (let n = 2; n <= 4; n++) if (k < n) { a += mean(G[n + '|' + k]); b += mean(G[n + '|0']); c++; } return c ? a / b : null; });
    const kM = [0, 1, 2, 3, 4, 5].map((k) => { if (k === 0) return 1; let a = 0, c = 0; for (let n = 2; n <= 6; n++) if (k < n) { a += ratio(RED[n + '|' + k], RED[n + '|0']).r; c++; } return c ? a / c : null; });
    const tb = SL.table();
    check(!!tb && JSON.stringify(tb) === JSON.stringify(JSON.parse(JSON.stringify(tb))), 'SL.table() is not JSON-able');
    if (tb) {
      check(JSON.stringify(tb.gen) === '[0,1,2,3,4,5]' && tb.keep.length === 6 && tb.keep.every((x) => x === 1), 'SL.table(): gen / keep are not the documented arrays');
      for (let k = 0; k < 6; k++) { if (kS[k] === null) check(tb.keepSuccess[k] === null, `keepSuccess[${k}] should be null`); else near(tb.keepSuccess[k], kS[k], T0, `keepSuccess[${k}]`); near(tb.keepSmooth[k], kM[k], T0, `keepSmooth[${k}]`); }
      for (let n = 1; n <= 6; n++) { near(tb.valueByGen[n - 1], mean(G[n + '|0']), T0, `table().valueByGen ${n}`); near(tb.postsByGen[n - 1], F['po' + n], 1e-3, `table().postsByGen ${n}`); }
      near(tb.driftKeep.keep[1], F.dr01, 1e-3, 'driftKeep 1.5'); near(tb.driftKeep.keep[2], F.dr02, 1e-3, 'driftKeep 2'); near(tb.driftKeep.keepSmooth[2], F.ds02, 1e-3, 'driftKeepSmooth 2');
      near(tb.framesPerRound, F.fpr, 1e-3, 'table().framesPerRound'); check(Array.isArray(tb.roundsOnlyByGen) && tb.roundsOnlyByGen.length === 6 && tb.roundsOnlyByGen[0] === null && tb.roundsOnlyByGen[1] === null, 'SL.table().roundsOnlyByGen should be null for gen 0 and 1'); for (let n = 3; n <= 6; n++) near(tb.roundsOnlyByGen[n - 1], F['d_' + n + '_noD'], 1e-3, `roundsOnlyByGen ${n}`); check(typeof tb.notes === 'object' && !!tb.notes.dropDemos, 'SL.table().notes lacks the finding about the calm demonstrations');
      put('tb_bytes', JSON.stringify(tb).length, 0);
    }
  }
  finish(res, { G, RED, FAR, DR, DEV, COV, R0, pool, redD });
}

/* ───────────── the claims of the prose, and the widget driven through the states the prose names ───────────── */
function finish(res, ctx) {
  const { G, RED } = ctx, ok = (c, m) => check(c, 'claim: ' + m);
  const inr = (x, lo, hi) => x >= lo && x <= hi;
  /* section 1 */
  ok(Math.abs(F.fpr - 823.5) < 1 && F.set_s === 40 && inr(F.set_cost, 0.988, 0.990) && F.p_corr === 89, 'a round is about 824 frames; 800 frames are 40 s and $0.99 at $89 an hour');
  ok([1, 2, 3, 4, 5, 6].every((n) => F['to' + n] === 0), 'no run times out: a run fails only by ending in a post');
  ok([1, 2, 3, 4, 5].every((n) => F['su' + n] < F['su' + (n + 1)]) && inr(F.su1, 61.5, 62.5) && inr(F.su6, 96, 97), 'the clones complete 62 to 97 % of the runs and improve with every round');
  ok(inr(F.stock80, 2.95, 2.96) && inr(F.stock50, 1.87, 1.88) && inr(F.lk80, 26, 27) && inr(F.lk50, 53, 54), 'the arithmetic of rent');
  /* section 2 and 3 */
  ok([1, 2, 3].every((k) => F['g4_' + k] <= 2.0) && F.g5_0 <= 2 && F.g6_0 <= 2, 'from clone 4 on no set adds more than about 2 points');
  ok(F.rmin >= 0.85 && F.r2_1 === F.rmin, 'the lowest of the fifteen smooth cells is clone 2, age 1, at about 0.87');
  ok([2, 3, 4, 5, 6].every((n) => F['r' + n + '_' + (n - 1)] > F['r' + n + '_1'] || n === 2), 'in every row the oldest set is worth more than the youngest');
  ok(F.r6_2 < F.r6_1 && F.r6_1 - F.r6_2 < F.rse6_1 + F.rse6_2, 'the one dip (clone 6, age 2) is inside its standard errors');
  ok(F.keep_s1 > 1.15 && F.keep_s1 < 1.3, 'the five cells at age 1 average about 1.2');
  ok(F.z43 > 6 && F.z43b > 4.5, 'rent at 0.8 and at 0.95 per retraining is rejected at clone 4, age 3 by 6 and by 4.5 standard errors');
  ok([[2, 1], [3, 1], [3, 2]].every(([n, k]) => Math.abs(F['rs' + n + '_' + k] - 1) <= 1.5 * F['rss' + n + '_' + k]) && F.rss2_1 > 0.09 && F.rss3_1 < 0.13 && F.rss3_2 < 0.13, 'the success cells at clones 2 and 3 are within about one standard error of 1 and 0.10 to 0.12 wide');
  ok(F.rs2_1 - 0.8 < 2 * F.rss2_1 && F.rs3_1 - 0.8 < 2 * F.rss3_1, 'at age 1 neither success cell is two standard errors from 0.8: they cannot separate 0.8 from 1 one at a time');
  ok([1, 2, 3].every((k) => F['g4_' + k] > F.g4_0), 'at clone 4 every old set adds more than the fresh one');
  /* section 4 */
  ok([1, 2, 3, 4, 5].every((n) => F['rc_c' + n] > F['rc_c' + (n + 1)]) && [1, 2, 3, 4].every((n) => F['ov_c' + n] > F['ov_c' + (n + 1)]) && Math.abs(F.ov_c5 - F.ov_c6) < 0.02, 'the reach and the share beyond clone 1\'s reach fall with the clone (the last two are level)');
  ok(inr(F.ov_c1, 0.95, 1.05), 'by definition 1 % of clone 1\'s frames lie beyond its own 99th percentile');
  ok(F.cv_c1 > 91 && F.cv_c1 < 92.5 && [2, 3, 4, 5, 6].every((n) => F['cv_c' + n] > 95 && F['cv_c' + n] < 96.5), 'the bulk is covered: 92 % of clone 1\'s frames and 95 to 96 % of the later ones');
  ok(F.far4_3 > 2.5 * F.far4_0 && F.corr4 > 0.65, 'old sets hold the tail: 6.4 % against 2.2 % of frames beyond 4 cm, and the share tracks the value at 0.69');
  ok(F.corrn4 === 160, 'the correlation at clone 4 is over 160 sets');
  /* section 5 */
  ok(inr(F.dr01, 0.75, 0.85) && inr(F.dr02, 0.75, 0.85) && Math.abs(F.dr01 - F.dr02) < 0.05, 'a fifth is lost at gust x1.5 and at x2, the same');
  ok(inr(F.loss2, 17, 21), 'the baton\'s "about a fifth when the gust doubles"');
  ok(F.ds01 < F.dr01 && F.ds02 < F.dr02 && inr(F.ds01, 0.72, 0.8) && inr(F.ds02, 0.67, 0.74), 'by the copy error the loss is larger');
  ok(F.dr12 > 0.93 && F.dr12 < 1.03, 'a set made at 0.075 loses almost nothing at 0.10');
  ok(F.dr10 > 1.1 && F.dr20 > 1.1 && F.dr21 > 0.95, 'below the diagonal the harsher world\'s set is worth more than a fresh one');
  ok(F.rc_c1 < F.rc_g1 && F.rc_g1 < F.rc_g2 && F.ov_c1 < F.ov_g1 && F.ov_g1 < F.ov_g2 && F.far_g0 < F.far_g1 && F.far_g1 < F.far_g2, 'reach, the share beyond the 0.05 world\'s reach and the tail of a set all grow with the gust');
  ok(Math.abs(F.side_r - 1) <= 2 * F.side_rse && F.side_stale < F.side_fresh && F.side_n === 48, 'sideways: 0.92 +- 0.06, a loss within two standard errors');
  ok(inr(F.rent2, 0.18, 0.21), 'the rent of a fifth of a $0.99 set is about $0.19');
  /* section 6 */
  ok([1, 2, 3, 4, 5].every((n) => F['po' + n] > F['po' + (n + 1)]) && [1, 2, 3].every((n) => F['g' + n + '_0'] > F['g' + (n + 1) + '_0']), 'posts fall with every clone and the fresh set\'s gain falls through the first four');
  ok(inr(F.g1_0, 17.5, 18.5 + 1) && inr(F.g4_0, 0.5, 1.5) && inr(F.loss2, 15, 25) && F.po5 < 5 && F.po4 > 5, 'the four phrases of the exit baton: about eighteen points (18.5), the fourth about one, a fifth, one run in twenty lies between clones 4 and 5');
  ok(inr(F.inv4, 17.5, 18) && inr(F.inv5, 23, 24), 'one run in 18 at clone 4 and one in 24 at clone 5');
  ok(inr(F.ppd_ratio, 21, 22.5) && inr(F.none5_4, 74, 76) && inr(F.g4_3 / F.g4_0, 1.7, 2.3), 'about 22 times fewer points per dollar; three rounds in four show clone 4 no failure; the first clone\'s set adds twice a fresh one');
  ok([3, 4, 5, 6].every((n) => F['nd' + n] > F['wd' + n]) && F.nd4 > 99.5 && inr(F.wd4, 94, 95), 'with two rounds stored the rounds alone beat the rounds with the demonstrations');
  const cs = LG.TABLE.recover.corr.s; ok(cs.slice(-3).every((x) => x >= 0.94 && x <= 0.97), 'the ledger\'s corrections curve levels off near 96 %');
  ok(inr(F.sat_video, 55.5, 56.5) && inr(F.sat_s1, 82, 82.6), 'lesson 3\'s ceilings of footage and of the 1 % simulator');
  ok(inr(F.lose_new, 20, 22) && inr(F.lose_old, 17.5, 19), 'keeping only the newest round costs 21 points, only the oldest 18');
  ok(F.ck_a > 17 && F.ck_b > 74 && inr(F.ck_c, 6.5, 7), 'the exercise: 17.8 runs, 75 %, 6.8 times dearer');

  /* the widget on this lineage: the page's own engine path against cells computed here */
  const html = path.join(root, dir, '04_perishable_data.html');
  if (fs.existsSync(html)) {
    const pg = loadPage(html); pg.problems.forEach((p) => fail('page problem: ' + p));
    const L8 = lineage(8), cache = {}, cell = (n, k, gi, gj) => cache[[n, k, gi, gj]] || (cache[[n, k, gi, gj]] = smoothCell(L8, n, k, gi, gj));
    const eqd = (id, want, digits, what) => { const got = pg.num(id); if (!(Math.abs(got - want) <= 0.5 * Math.pow(10, -digits) + 1e-9)) fail(`${what}: widget #${id} prints ${got}, independent computation gives ${want.toFixed(digits + 2)}`); };
    const second = (id) => { const m = /±\s*([\d.]+)/.exec(pg.text(id)); return m ? parseFloat(m[1]) : NaN; };
    const STATES = {
      d: [4, 3, 0, 0, 0], f: [4, 0, 0, 0, 0], o: [6, 5, 0, 0, 0], y: [2, 1, 0, 0, 0], w: [1, 0, 2, 0, 2], h: [1, 0, 3, 1, 0]       // clone, age, index of the world in the page's selector, gust index of the set, of the clone
    };
    const probe = (tag, name) => {
      const [n, k, wi, gi, gj] = STATES[tag], kk = Math.min(k, n - 1), set = cell(n, kk, gi, gj), fresh = cell(n, 0, gj, gj);
      pg.set('w04-n', n); pg.set('w04-w', wi); pg.set('w04-k', k);
      const mS = 100 * mean(set.red), mF = 100 * mean(fresh.red), same = kk === 0 && gi === gj, r = mean(set.red) / mean(fresh.red);
      eqd('w04-val', mS, 2, name + ' value of the set'); eqd('w04-fresh', mF, 2, name + ' value of a fresh set'); eqd('w04-r', r, 2, name + ' live relevance');
      if (!same) { const ea = se(set.red), eb = se(fresh.red), ma = mean(set.red), mb = mean(fresh.red), e = Math.sqrt((ea / mb) ** 2 + (ma * eb / (mb * mb)) ** 2); if (!(Math.abs(second('w04-r') - e) <= 0.005 + 1e-9)) fail(`${name}: live relevance s.e. ${second('w04-r')} against ${e.toFixed(4)}`); }
      if (Math.abs(second('w04-val') - 100 * se(set.red)) > 0.005 + 1e-9) fail(`${name}: s.e. of the value ${second('w04-val')} against ${(100 * se(set.red)).toFixed(4)}`);
      eqd('w04-cov', 100 * set.cov0, 1, name + ' coverage'); eqd('w04-far', 100 * mean(set.far), 1, name + ' far share');
      eqd('w04-post', F['po' + n], 1, name + ' posts'); eqd('w04-ppd', F['ppd' + n], 2, name + ' points per dollar');
      return { n, kk, set, fresh, mS, mF, r };
    };
    const S1 = probe('d', 'default state');
    put('x1_val', S1.mS, 4); put('x1_vals', 100 * se(S1.set.red), 4); put('x1_fresh', S1.mF, 4); put('x1_r', S1.r, 4); put('x1_cov', 100 * S1.set.cov0, 3); put('x1_far', 100 * mean(S1.set.far), 3);
    eqd('w04-rs', F.r4_3, 2, 'default state: stored relevance'); eqd('w04-rg', F.rs4_3, 2, 'default state: stored success relevance'); eqd('w04-gain', F.g4_3, 2, 'default state: success gain');
    if (!/clone 1, gust 0\.05/.test(pg.text('w04-src'))) fail('default state: the source reads ' + pg.text('w04-src'));
    if (!/3 clones back/.test(pg.text('w04-k-v'))) fail('default state: the age label reads ' + pg.text('w04-k-v'));
    { const m = /\(([\d.]+)\)/.exec(pg.text('w04-gain')); if (!m || Math.abs(parseFloat(m[1]) - F.g4_0) > 0.005 + 1e-9) fail('default state: fresh success gain reads ' + pg.text('w04-gain')); }
    const S0 = probe('f', 'age 0'); put('x0_far', 100 * mean(S0.set.far), 3);
    if (!/^1 \(a fresh set\)/.test(pg.text('w04-rs')) || !/^1 \(a fresh set\)/.test(pg.text('w04-rg'))) fail('age 0: stored relevance should read 1 (a fresh set)');
    check(Math.abs(S0.r - 1) < 1e-12, 'age 0: the live relevance of a fresh set is 1');
    const S6 = probe('o', 'clone 6, age 5'); eqd('w04-rs', F.r6_5, 2, 'clone 6: stored relevance'); if (pg.text('w04-rg') !== '–' || pg.text('w04-gain') !== '–') fail('clone 6, age 5: the success cells should read –');
    probe('y', 'clone 2, age 1'); eqd('w04-rs', F.r2_1, 2, 'clone 2: stored relevance'); eqd('w04-rg', F.rs2_1, 2, 'clone 2: stored success relevance'); eqd('w04-gain', F.g2_1, 2, 'clone 2: success gain');
    const S2 = probe('w', 'clone 1, set 0.05, clone 0.10'); put('x2_r', S2.r, 4); put('x2_cov', 100 * S2.set.cov0, 3);
    eqd('w04-rs', F.ds02, 2, 'drift: stored relevance (copy error)'); eqd('w04-rg', F.dr02, 2, 'drift: stored relevance (success)'); eqd('w04-gain', F.dg02, 2, 'drift: success gain');
    { const m = /\(([\d.]+)\)/.exec(pg.text('w04-gain')); if (!m || Math.abs(parseFloat(m[1]) - F.dg22) > 0.005 + 1e-9) fail('drift: the gain of a fresh set reads ' + pg.text('w04-gain')); }
    const S3 = probe('h', 'clone 1, set 0.075, clone 0.05'); eqd('w04-rs', F.ds10, 2, 'harsher world: stored relevance (copy error)'); eqd('w04-rg', F.dr10, 2, 'harsher world: stored relevance (success)');
    ok(S1.r > 1 && S2.r < 1 && S3.r > 1, 'live: the first clone\'s set at clone 4 is worth more than a fresh one, the gentler world\'s set at gust 0.10 less, a harsher world\'s set more');
    ok(inr(S1.mS, 2.5, 4.5) && inr(S1.mF, 1.5, 3) && inr(100 * S1.set.cov0, 96, 98.5), 'the live default state reads as the prose says');
    ok(S1.set.cov0 > 0.9 && 100 * mean(S1.set.far) > 3 * 100 * mean(S0.set.far), 'on this lineage the old set holds several times the fresh set\'s tail');
    ok(100 * S2.set.cov0 < 80 && 100 * S2.set.cov0 > 65, 'coverage falls below 80 % when the gust doubles');
    pg.set('w04-n', 4); pg.set('w04-w', 0); pg.set('w04-k', 3);
    check(pg.counter.draws > 20, 'the widget draws');
  }
  console.log(JSON.stringify({ facts: F }));
  process.exit(bad ? 1 : 0);
}
