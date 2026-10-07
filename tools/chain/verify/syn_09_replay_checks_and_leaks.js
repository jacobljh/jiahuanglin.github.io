#!/usr/bin/env node
'use strict';
/* Oracle for synthetic_vision lesson 09 (replay, checks and leaks).
 *
 * Re-derives every number the lesson quotes with code that does not share a code path with the page or the builder:
 *   - the arithmetic of looking (closed form against a hypergeometric simulation; the million-frame product);
 *   - the manifest: FNV-1a 64 against its published test vectors, the digest's sensitivity to one grey level and one mask pixel, the birthday arithmetic against a 16-bit truncation of real digests, the row size,
 *     integrity and replay on fresh runs (a drifted dependency, an unseeded noise stream, a stale buffer, reversed labels, and twelve deterministic faults that both audits miss);
 *   - the invariants: this file's own implementations of the ground-plane law, the range law, the label rule, the mask-against-instance clause and the exposure clause, compared flag for flag with the engine's on fresh frames;
 *     the false-alarm counts on 5,000 fresh frames of bbba and 2,000 of aaaa (a block no tolerance was set on), the noise-ratio z-scores at several tolerances, the batch checks on clean batches, the exact binomial tail of the rate check;
 *   - the bench: five faults recomputed from scratch with this file's own injectors (the per-frame detection probability c of every invariant against the builder's table), the closed form 1 - (1 - f c)^k against a simulation,
 *     the counting (what the invariants, the manifest and the canary flag) re-derived from the table's raw numbers, the canary recomputed for one clean and one faulty run, the exam table against tables.js;
 *   - the leaks: the sibling counts in closed form and by enumeration, a hash join over 2,400 sibling frames, one 1-NN / 10-NN cell and one detector cell recomputed from scratch with this file's own k-nearest-neighbour and AUC;
 *   - the exit: the naive program aaaa through every check on fresh frames;
 *   - the widget, driven through the states the prose names.
 * Where a number compares the lesson's estimate with a hidden truth the comment says so (here nothing reads SV.REAL: the lab privilege is the injected fault, which the oracle knows because it injects it).
 * Last stdout line: {"facts": {...}}. */
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '../../../all_lessons');
const dir = fs.existsSync(path.join(root, 'synthetic_vision_new')) ? 'synthetic_vision_new' : 'synthetic_vision';
const SV = require(path.join(root, dir, 'street.js'));
require(path.join(root, dir, 'tables.js'));
const L = require(path.join(root, dir, 'l09_factory.js'));
try { require(path.join(root, dir, 'l09_data.js')); } catch (e) { /* the builder has not run yet */ }
const T = SV.TABLES, D = SV.L09;
const { loadPage } = require('../dom_probe.js');
const T0 = Date.now();
const lap = (m) => process.stderr.write('[' + ((Date.now() - T0) / 1000).toFixed(0) + 's] ' + m + '\n');

let bad = 0;
const fail = (m) => { bad++; console.error('FAIL ' + m); };
const check = (c, m) => { if (!c) fail(m); };
const F = {};
const put = (k, v, d) => { F[k] = +(+v).toFixed(d === undefined ? 6 : d); };
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const sdev = (a) => { const m = mean(a); return Math.sqrt(a.reduce((x, y) => x + (y - m) * (y - m), 0) / (a.length - 1)); };
const pc = (x) => 100 * x;
const CAM = SV.CAM, W = CAM.W, H = CAM.H, HW = W * H;
const bbba = L.program('bbba'), aaaa = L.program('aaaa'), declB = L.declOf(bbba), declA = L.declOf(aaaa);
const bitsOf = (hex) => { const a = []; for (let i = 0; i < 1000; i++) a.push((parseInt(hex.charAt(i >> 2), 16) >> (3 - (i & 3))) & 1); return a; };
const IDS = L.INV.map((I) => I.id), FAULT_IDS = L.FAULTS.map((f) => f.id);
const k95 = (q) => (q > 0 ? Math.max(1, Math.ceil(Math.log(0.05) / Math.log(1 - q))) : Infinity);

/* ───────────── 1 · looking ───────────── */
{
  const rng = SV.rng(909), nPop = 10000;
  for (const [fk, f] of [['25', 0.25], ['10', 0.1], ['1', 0.01], ['01', 0.001]]) for (const k of [20, 100, 1000]) {
    const p = 1 - Math.pow(1 - f, k); put('look_' + fk + '_' + k, p, 4);
    const nBad = Math.round(f * nPop), trials = 4000; let hit = 0;                 // an inspector opens k distinct frames of a run of 10,000 (hypergeometric), always sees a corrupted one
    for (let t = 0; t < trials; t++) {
      const idx = new Uint8Array(0), seen = new Set(); let found = false;
      for (let j = 0; j < k && !found; j++) { let i; do { i = Math.floor(rng() * nPop); } while (seen.has(i)); seen.add(i); if (i < nBad) found = true; }
      if (found) hit++;
    }
    check(Math.abs(hit / trials - p) < 4 * Math.sqrt(p * (1 - p) / trials) + 0.004, 'looking f=' + f + ' k=' + k + ': simulated ' + (hit / trials).toFixed(3) + ' vs closed form ' + p.toFixed(3));
  }
  let none = 1; for (let i = 0; i < 100; i++) none *= (999000 - i) / (1000000 - i);          // a million frames, 1,000 of them corrupted, a spot check of 100 (no replacement)
  put('mil_bad', 1000, 0); put('mil_p100', pc(1 - none), 1);
  put('look_k95_01', Math.ceil(Math.log(0.05) / Math.log(0.999)), 0); put('look_k95_1', Math.ceil(Math.log(0.05) / Math.log(0.99)), 0);
  check(F.mil_p100 > 9 && F.mil_p100 < 10, 'a 100-frame spot check of a million finds a 0.1% fault about 9.5% of the time');
}
lap('looking');

/* ───────────── 2 · the manifest ───────────── */
{
  check(L.hash64('') === 'cbf29ce484222325' && L.hash64('a') === 'af63dc4c8601ec8c' && L.hash64('foobar') === '85944171f73967e8', 'FNV-1a 64 reproduces the published test vectors');
  put('row_bytes', 3 * 4 + 8 + 8 + 1, 0); check(F.row_bytes === L.ROW_BYTES, 'row size');
  put('frame_bytes', 3 * W * H, 0); put('row_pct', pc(F.row_bytes / F.frame_bytes), 2); put('manifest_mb', F.row_bytes * 1e6 / 1e6, 0);
  const n = 1e6, pairs = n * (n - 1) / 2; put('coll32', pairs / Math.pow(2, 32), 0); put('coll64_inv_m', Math.pow(2, 64) / pairs / 1e6, 0);
  /* sensitivity: one grey level of one pixel changes the pixel digest, one coverage pixel changes the label digest; exactness: the digest of a re-made frame is the digest of the frame */
  let sens = 0, same = 0;
  for (let i = 0; i < 60; i++) {
    const rec = L.make(bbba, L.seedsOf(19810000 + i)), d0 = L.digest(rec), rec2 = L.make(bbba, L.seedsOf(19810000 + i)), d1 = L.digest(rec2);
    if (d0.hx === d1.hx && d0.hy === d1.hy) same++;
    const x = Float32Array.from(rec.x); const q = (i * 977) % x.length; x[q] = x[q] + (x[q] < 0.5 ? 1 : -1) / 255;
    const cov = Float32Array.from(rec.cov); const c = (i * 331) % HW; cov[c] = cov[c] > 0.5 ? 0 : 1;
    const dx = L.digest(Object.assign({}, rec, { x: x })), dy = L.digest(Object.assign({}, rec, { cov: cov }));
    if (dx.hx !== d0.hx && dx.hy === d0.hy && dy.hy !== d0.hy && dy.hx === d0.hx) sens++;
  }
  put('sens_trials', 60, 0); check(sens === 60 && same === 60, 'the digest is exact on re-made frames (' + same + '/60) and sensitive to one grey level and one mask pixel (' + sens + '/60)');
}
lap('manifest basics');

/* ───────────── 3 · the invariants: independent implementations and false alarms on fresh frames ───────────── */
const oracleFlags = {};                              // this file's own versions of five clauses (a different formulation each), compared with the engine frame by frame
function oGround(r) { let bad = 0, worst = 0; for (let v = 0; v < H; v++) for (let u = 0; u < W; u++) { const q = v * W + u; if (r.id[q] !== -1) continue; if (r.depth[q] > 0) { const z = CAM.hc / Math.tan(Math.atan((v + 0.5 - CAM.V0) / CAM.f)); const e = Math.abs(r.depth[q] - z) / z; worst = Math.max(worst, e); if (!(e <= 1e-6)) bad++; } else if (v + 0.5 > CAM.V0) bad++; } return { fail: bad > 0, v: worst }; }
function oRange(r) { let worst = 0; for (let v = 0; v < H; v++) for (let u = 0; u < W; u++) { const q = v * W + u, z = r.depth[q]; if (!(z > 0)) continue; const X = z * (u + 0.5 - W / 2) / CAM.f, Y = z * (CAM.V0 - v - 0.5) / CAM.f, e = Math.abs(r.range[q] - Math.hypot(X, Y, z)) / Math.hypot(X, Y, z); worst = Math.max(worst, e); } return { fail: !(worst <= 1e-6), v: worst }; }
function oLabel(r, lab) { let a4 = 0; for (let q = 0; q < HW; q++) a4 += Math.round(4 * r.cov[q]); const full4 = Math.round(4 * r.full), need4 = Math.max(4 * (lab.kvis || 0), lab.rel ? lab.rel * full4 : 0), y = a4 >= need4 && a4 > 0 ? 1 : 0; return { fail: y !== r.y || a4 !== Math.round(4 * r.area) || a4 > full4 }; }
function oMask(r) {
  const P = [], S = []; for (let v = 0; v < H; v++) for (let u = 0; u < W; u++) { const q = v * W + u; if (r.id[q] === r.pedId && r.pedId >= 0) P.push([u, v]); if (r.cov[q] > 0) S.push([u, v]); }
  if (r.pedId < 0) return { fail: S.length > 0 };
  const rowN = new Array(H).fill(0); P.forEach(([u, v]) => { rowN[v]++; }); let bad = 0;
  P.forEach(([u, v]) => { if (rowN[v] >= 2 && !(r.cov[v * W + u] > 0)) bad++; });
  S.forEach(([u, v]) => { if (rowN[v] >= 2 && !P.some(([a, b]) => Math.max(Math.abs(a - u), Math.abs(b - v)) <= 1)) bad++; });
  return { fail: bad > 0 };
}
function oGain(r, s) { if (!s.ae) return { fail: r.gain !== 1 }; let m = 0; for (let c = 0; c < 3; c++) for (let i = 0; i < HW; i++) m += Math.pow(r.x[c * HW + i], s.gamma); const ratio = m / (3 * HW) / s.ae.target, hi = r.gain >= s.ae.maxGain - 1e-9, lo = r.gain <= 1 + 1e-9, dev = hi ? Math.max(0, ratio - 1) : lo ? Math.max(0, 1 - ratio) : Math.abs(ratio - 1); return { fail: r.gain < 1 - 1e-9 || r.gain > s.ae.maxGain + 1e-9 || dev > 0.02, v: dev }; }

const FA = {};
for (const [name, pipe, decl, n, s0] of [['bbba', bbba, declB, 5000, 19850000], ['aaaa', aaaa, declA, 2000, 19860000]]) {
  const fails = {}, agree = { ground: 0, range: 0, label: 0, mask: 0, gain: 0 }, rows = [], zs = [], worst = { ground: 0, range: 0, gain: 0, sky: 0, noise: 0 };
  IDS.forEach((k) => { fails[k] = 0; });
  let nNoise = 0, hxs = new Set(), dups = 0, trunc = new Map(), coll16 = 0, nDig = 0;
  for (let i = 0; i < n; i++) {
    const rec = L.make(pipe, L.seedsOf(s0 + i)), st = L.stats(rec, decl), row = L.row(rec, i < Math.round(0.8 * n) ? 'train' : 'test');
    IDS.forEach((k) => { if (st[k].fail) fails[k]++; });
    const og = oGround(rec), or = oRange(rec), ol = oLabel(rec, decl.label), om = oMask(rec), oa = oGain(rec, decl.sensor);
    if (og.fail === st.ground.fail) agree.ground++; if (or.fail === st.range.fail) agree.range++; if (ol.fail === st.label.fail) agree.label++; if (om.fail === st.mask.fail) agree.mask++; if (oa.fail === st.gain.fail) agree.gain++;
    worst.ground = Math.max(worst.ground, og.v); worst.range = Math.max(worst.range, or.v); worst.gain = Math.max(worst.gain, st.gain.tol === 1 ? 0 : st.gain.v); worst.sky = Math.max(worst.sky, st.sky.v);
    if (st.noise.n > 0) { nNoise++; const z = (st.noise.v - 1) / (st.noise.tol / L.TOL.z); zs.push(Math.abs(z)); worst.noise = Math.max(worst.noise, Math.abs(z)); }
    if (i < 3000) { if (hxs.has(row.hx)) dups++; hxs.add(row.hx); nDig++; const t16 = row.hx.slice(-4); trunc.set(t16, (trunc.get(t16) || 0) + 1); }
    rows.push(row);
    if (i % 1000 === 0) lap(name + ' fresh frame ' + i);
  }
  FA[name] = { fails, agree, zs, worst, nNoise, rows, dups, trunc, nDig };
  put('fa_n_' + name, n, 0); put('fa_fail_' + name, Object.values(fails).reduce((a, b) => a + b, 0), 0);
  check(Object.values(fails).every((v) => v === 0), name + ': every per-frame invariant is silent on ' + n + ' fresh clean frames: ' + JSON.stringify(fails));
  Object.keys(agree).forEach((k) => check(agree[k] === n, name + ': own ' + k + ' clause agrees with the engine on ' + agree[k] + '/' + n + ' frames'));
  check(dups === 0, name + ': no two of the first 3000 frames share a pixel digest');
}
put('fa_worst_ground_e8', FA.bbba.worst.ground * 1e8, 1); put('fa_worst_range_e7', Math.max(FA.bbba.worst.range, FA.aaaa.worst.range) * 1e7, 1);
put('fa_worst_gain_pct', 100 * FA.bbba.worst.gain, 2); put('fa_worst_sky', FA.bbba.worst.sky, 3); put('fa_worst_noise_z', FA.bbba.worst.noise, 1);
put('f32_eps_e7', Math.pow(2, -23) * 1e7, 2);
if (D) { const fb = D.fa.bbba, fa_ = D.fa.aaaa; put('fa_build_bbba', fb.n, 0); put('fa_build_aaaa', fa_.n, 0); check(Object.values(fb.fails).every((v) => v === 0) && Object.values(fa_.fails).every((v) => v === 0), 'the builder frames the tolerances were examined on are silent too'); }
put('fa_noise_checked_pct', pc(FA.bbba.nNoise / 5000), 0);
for (const z of [3, 4, 5, 6]) put('fa_z' + z, pc(FA.bbba.zs.filter((v) => v > z).length / FA.bbba.nNoise), 2);          // the share of clean frames a noise tolerance of z sigma would flag
put('fa_z3_per_million', F.fa_z3 * 1e6 / 100, 0);
{ /* the birthday arithmetic against 16 real bits: 3,000 digests truncated to 16 bits */
  let pairsSeen = 0; FA.bbba.trunc.forEach((c) => { pairsSeen += c * (c - 1) / 2; });
  const expect = 3000 * 2999 / 2 / 65536; put('coll16_expect', expect, 1); put('coll16_seen', pairsSeen, 0);
  check(Math.abs(pairsSeen - expect) < 4 * Math.sqrt(expect), 'birthday: ' + pairsSeen + ' truncated collisions vs ' + expect.toFixed(1) + ' expected');
}
/* the pedestrian-rate tolerance: exact binomial tail of the 5-sigma interval at n = 1000, p = 1/2 */
{
  const n = 1000, p = 0.5, sd = Math.sqrt(n * p * (1 - p)), lo = n * p - 5 * sd, hi = n * p + 5 * sd; let tail = 0, lg = [0]; for (let i = 1; i <= n; i++) lg.push(lg[i - 1] + Math.log(i));
  for (let k = 0; k <= n; k++) if (k < lo || k > hi) tail += Math.exp(lg[n] - lg[k] - lg[n - k] + n * Math.log(0.5));
  put('rate_lo', lo, 0); put('rate_hi', hi, 0); put('rate_tail_e7', tail * 1e7, 1); check(tail < 2e-6, 'the 5-sigma rate interval is left by a clean batch with probability ' + tail);
}
{ /* batch checks on clean batches and the pooled noise law per batch of 100 */
  const rows = FA.bbba.rows; let rateFail = 0, dupFail = 0, linFail = 0, peds = [];
  for (let b = 0; b < 5; b++) { const br = rows.slice(b * 1000, (b + 1) * 1000).map((r, i) => Object.assign({}, r, { split: i < 800 ? 'train' : 'test' })), r = L.batch(br, declB); if (r.fail.rate) rateFail++; if (r.fail.dup) dupFail++; if (r.fail.lineage) linFail++; peds.push(r.ped); }
  check(rateFail === 0 && dupFail === 0 && linFail === 0, 'clean batches pass dup, lineage and rate'); put('clean_batches', 5, 0);
  const pools = []; let poolFail = 0;
  for (let b = 0; b < 40; b++) { const rr = []; for (let i = 0; i < 100; i++) rr.push(L.make(bbba, L.seedsOf(19850000 + b * 100 + i))); const p = L.noisePool(rr, declB); pools.push(p.v); if (p.fail) poolFail++; }
  put('pool_clean_n', 40, 0); put('pool_clean_mean', mean(pools), 3); put('pool_clean_sd', sdev(pools), 3); put('pool_fail_clean', poolFail, 0); check(poolFail === 0, 'clean 100-frame batches pass the pooled noise law');
}
lap('invariants and false alarms');

/* ───────────── 4 · the bench ───────────── */
/* this file's own injectors for five faults (a different code path from the engine's), checked against the builder's table of per-frame detection probabilities */
const own = {
  flip: (r) => { const x = new Float32Array(r.x.length); for (let c = 0; c < 3; c++) for (let v = 0; v < H; v++) for (let u = 0; u < W; u++) x[c * HW + v * W + (W - 1 - u)] = r.x[c * HW + v * W + u]; return Object.assign({}, r, { x }); },
  swap: (r) => { const x = Float32Array.from(r.x); for (let i = 0; i < HW; i++) { x[i] = r.x[2 * HW + i]; x[2 * HW + i] = r.x[i]; } return Object.assign({}, r, { x }); },
  mask: (r) => { const cov = new Float32Array(HW); for (let v = 0; v < H; v++) for (let u = 1; u < W; u++) cov[v * W + u] = r.cov[v * W + u - 1]; return Object.assign({}, r, { cov }); },
  thresh: (r) => Object.assign({}, r, { y: r.area >= 4 && r.area > 0 ? 1 : 0 }),
  upside: (r) => { const fy = (a, planes) => { const o = new a.constructor(a.length); for (let c = 0; c < planes; c++) for (let v = 0; v < H; v++) o.set(a.subarray(c * HW + (H - 1 - v) * W, c * HW + (H - v) * W), c * HW + v * W); return o; }; return Object.assign({}, r, { x: fy(r.x, 3), cov: fy(r.cov, 1), depth: fy(r.depth, 1), range: fy(r.range, 1), id: fy(r.id, 1) }); },
};
if (D) {
  const NB = 500;
  for (const id of ['upside', 'flip', 'swap', 'mask', 'thresh']) {
    const cnt = {}; IDS.forEach((k) => { cnt[k] = 0; }); let any = 0;
    for (let i = 0; i < NB; i++) { const rec = own[id](L.make(bbba, L.seedsOf(19870000 + i))), fl = L.check(rec, declB); fl.forEach((k) => { cnt[k]++; }); if (fl.length) any++; }
    IDS.forEach((k) => { const c0 = D.bench[id].c[k], c1 = cnt[k] / NB; check(Math.abs(c1 - c0) <= 4 * Math.sqrt(Math.max(c0 * (1 - c0), 0.0025) * (1 / NB + 1 / 1000)) + 0.01, id + ' / ' + k + ': fresh c ' + c1.toFixed(3) + ' vs table ' + c0.toFixed(3)); });
    check(Math.abs(any / NB - D.bench[id].cAny) <= 4 * Math.sqrt(Math.max(D.bench[id].cAny * (1 - D.bench[id].cAny), 0.0025) * (1 / NB + 1 / 1000)) + 0.01, id + ': fresh c(any) ' + (any / NB).toFixed(3) + ' vs table ' + D.bench[id].cAny);
    put('fresh_c_' + id, any / NB, 3);
  }
  ['depth', 'focal', 'centre'].forEach((id) => check(D.bench[id].c.ground === 1 && D.bench[id].c.range === 1, id + ': the exact laws flag every frame'));
  /* the table, restated: per-frame c of the union, k95 for the nominal f, the batch and manifest results */
  const rows = {};
  for (const fid of FAULT_IDS) {
    const b = D.bench[fid], Fd = L.faultById(fid), r = b.run, cE = b.cAny !== undefined ? b.cAny : r.cHit, q = Fd.f * cE;
    const perFrame = b.c ? IDS.filter((k) => 1 - Math.pow(1 - Fd.f * b.c[k], 1000) >= 0.95) : (cE > 0 && 1 - Math.pow(1 - q, 1000) >= 0.95 ? ['frames'] : []);
    const batch = [r.dup > 0 ? 'dup' : '', r.lineage > 0 ? 'lineage' : '', r.rateFail ? 'rate' : '', b.pool.fails.some((x) => x) ? 'pool' : ''].filter(Boolean);
    const man = [r.integrity > 0 ? 'integrity' : '', r.replay > 0 ? 'replay' : ''].filter(Boolean);
    rows[fid] = { f: Fd.f, c: cE, q, k95: k95(q), perFrame, batch, man, inv: perFrame.length + batch.length > 0, manifest: man.length > 0 };
    put('c_' + fid, cE, 3); if (isFinite(rows[fid].k95)) put('k95_' + fid, rows[fid].k95, 0);
  }
  put('n_faults', FAULT_IDS.length, 0);
  put('n_inv', FAULT_IDS.filter((f) => rows[f].inv).length, 0);
  put('n_man', FAULT_IDS.filter((f) => rows[f].manifest).length, 0);
  put('n_man_new', FAULT_IDS.filter((f) => rows[f].manifest && !rows[f].inv).length, 0);
  put('n_union', FAULT_IDS.filter((f) => rows[f].inv || rows[f].manifest).length, 0);
  put('n_inv_perframe', FAULT_IDS.filter((f) => rows[f].perFrame.length > 0).length, 0);
  put('n_inv_batch_only', FAULT_IDS.filter((f) => rows[f].perFrame.length === 0 && rows[f].batch.length > 0).length, 0);
  const nothing = FAULT_IDS.filter((f) => !rows[f].inv && !rows[f].manifest);
  put('n_nothing', nothing.length, 0);
  check(nothing.length >= 1, 'the bench contains a fault no check inside the factory flags: ' + nothing.join(','));
  F._rows = rows;
  /* the closed form against a simulation of k frames drawn from a stream in which a fraction f is touched and each touched frame is flagged with probability c */
  const rngm = SV.rng(31337);
  for (const id of ['flip', 'mask', 'thresh']) {
    const f = L.faultById(id).f, c = rows[id].c, k = rows[id].k95; let hit = 0; const trials = 6000;
    for (let t = 0; t < trials; t++) { let found = false; for (let j = 0; j < k && !found; j++) if (rngm() < f && rngm() < c) found = true; if (found) hit++; }
    const p = hit / trials; put('mc_k95_' + id, p, 3); check(p > 0.93 && p < 0.97, id + ': k95 = ' + k + ' frames finds the fault ' + p.toFixed(3) + ' of the time');
  }
  /* replay and integrity on fresh runs (300 frames): a drifted dependency, an unseeded noise stream, a stale buffer, reversed labels, and a deterministic fault */
  const rrng = SV.rng(77); let detMiss = 0; const DET = FAULT_IDS.filter((f) => L.faultById(f).where === 'gen');
  for (const id of ['drift', 'nondet', 'stale', 'rows', 'mask']) {
    const run = L.run(bbba, 300, 19880000, id), au = L.audit(run, 300, rrng);
    put('fresh_replay_' + id, pc(au.replay.length / 300), 1); put('fresh_integrity_' + id, pc(au.integrity.length / 300), 1);
    if (id === 'drift') check(au.replay.length === 300 && au.integrity.length === 0, 'replay flags every row after a drift');
    if (id === 'mask') check(au.replay.length === 0 && au.integrity.length === 0, 'both audits pass a deterministic fault');
    if (id === 'rows') { const shard = Math.floor(0.5 * 300) - Math.floor(0.4 * 300); check(au.integrity.length >= 0.9 * shard && au.integrity.length <= shard && au.replay.length === 0, 'integrity flags the reversed batch (' + au.integrity.length + ' of ' + shard + ') and replay does not'); }
    if (id === 'nondet') check(Math.abs(au.replay.length / 300 - 0.1) < 0.06, 'replay finds the unseeded fraction');
    if (id === 'stale') check(Math.abs(au.replay.length / 300 - 0.05) < 0.045, 'replay finds the stale fraction');
  }
  put('rp_drift', D.bench.drift.run.replay, 0); put('rp_nondet', pc(D.bench.nondet.run.replay / 1000), 1); put('rp_stale', pc(D.bench.stale.run.replay / 1000), 1); put('int_rows', D.bench.rows.run.integrity, 0);
  put('rp_det_n', DET.length, 0); put('rp_det', DET.reduce((s, f) => s + D.bench[f].run.replay + D.bench[f].run.integrity, 0), 0); check(F.rp_det === 0, 'eleven deterministic faults pass both audits');
  put('rp_k95_10', Math.ceil(Math.log(0.05) / Math.log(0.9)), 0); put('rp_k95_5', Math.ceil(Math.log(0.05) / Math.log(0.95)), 0);
  put('rows_unflagged', 100 - D.bench.rows.run.integrity, 0);
  put('seeds_dup', D.bench.seeds.run.dup, 0); put('seeds_lineage', D.bench.seeds.run.lineage, 0); put('stale_dup', D.bench.stale.run.dup, 0);
  put('pped_count', D.bench.pped.run.ped, 0); put('pped_lo', D.bench.pped.run.lo, 0); put('pped_hi', D.bench.pped.run.hi, 0); put('pped_z', (D.bench.pped.run.ped - 500) / Math.sqrt(250), 1);
  put('pool_read', D.bench.read.pool.ratios[4], 3); put('pool_flip', D.bench.flip.pool.ratios[4], 3); put('pool_rows', D.bench.rows.pool.ratios[4], 3);
  put('pool_tol', L.POOL_BIAS, 2);
  /* the pooled law on a fresh shard with read noise missing (this file builds the faulty pipeline itself) */
  { const q = SV.clone(bbba); q.sensor.read = 0; const rr = []; for (let i = 0; i < 100; i++) rr.push(L.make(q, L.seedsOf(19890000 + i))); const p = L.noisePool(rr, declB); put('pool_read_fresh', p.v, 3); check(p.fail && Math.abs(p.v - F.pool_read) < 0.02, 'pooled noise law flags a fresh shard without read noise: ' + p.v.toFixed(3)); }
  /* the canary: its calibration, its false alarms, the faults it flags; and two runs recomputed from scratch */
  const A = D.canary.calA, Bf = D.canary.calB, thr = mean(A) - 3 * sdev(A);
  put('can_mean', mean(A), 3); put('can_sd', sdev(A), 3); put('can_thr', thr, 3); put('can_fa', Bf.filter((x) => x < thr).length, 0); put('can_nfresh', Bf.length, 0); put('can_n', L.CANARY.n, 0); put('can_held', L.CANARY.nHeld, 0);
  put('can_drop3', 3 * sdev(A), 3); put('can_sigma_palette', (mean(A) - mean(D.canary.faults.palette)) / sdev(A), 1); put('seeds_hit', D.bench.seeds.run.hit, 0);
  const cflag = FAULT_IDS.filter((f) => D.canary.faults[f].filter((x) => x < thr).length >= 2);
  put('can_flagged', cflag.length, 0); put('can_new', cflag.filter((f) => !rows[f].inv && !rows[f].manifest).length, 0);
  FAULT_IDS.forEach((f) => { put('can_auc_' + f, mean(D.canary.faults[f]), 3); put('can_n_' + f, D.canary.faults[f].filter((x) => x < thr).length, 0); });
  F._cflag = cflag;
  { const run = L.run(bbba, 1000, 19400000, null), a = L.canary(run.recs, 800, 1).auc; check(Math.abs(a - D.canary.calA[0]) < 1e-4, 'canary clean run recomputed: ' + a + ' vs ' + D.canary.calA[0]); }
  { const run = L.run(bbba, 1000, 19520000, 'flip'), a = L.canary(run.recs, 800, 101).auc; check(Math.abs(a - D.canary.faults.flip[0]) < 1e-4, 'canary flip run recomputed: ' + a + ' vs ' + D.canary.faults.flip[0]); }
  lap('bench and canary');
  /* the exam: the clean cell is the cell bbba of tables.js (same frames, same procedure); the faults are compared with the seed-to-seed spread of that cell */
  const cleanMiss = D.exam.clean.map((e) => e.miss), tabMiss = T.swap.bbba.realMiss;
  check(cleanMiss.every((v, i) => Math.abs(v - tabMiss[i]) < 1e-9), 'the clean exam through the engine is the table cell bbba: ' + cleanMiss + ' vs ' + tabMiss);
  put('exam_clean', pc(mean(cleanMiss)), 1); put('exam_sd', pc(sdev(cleanMiss)), 1);
  Object.keys(D.exam).filter((k) => k !== 'clean').forEach((id) => { const m = D.exam[id].map((e) => e.miss); put('exam_' + id, pc(mean(m)), 1); put('exam_sd_' + id, pc(sdev(m)), 1); put('exam_d_' + id, pc(mean(m) - mean(cleanMiss)), 1); });
}
lap('bench done');

/* ───────────── 5 · leaks ───────────── */
if (D) {
  const S = D.config.leak.scenes, NS = D.config.leak.sibs;
  put('sib_n', NS, 0); put('sib_exp', (NS - 1) * 0.8, 1); put('sib_none_pct', pc(Math.pow(0.2, NS - 1)), 1); put('leak_scenes', S, 0); put('leak_frames', S * NS, 0);
  /* by enumeration, seed 1: how many siblings of a test frame lie in the training set under each split */
  const items = L.withFeat(L.siblings(bbba, S, NS, 19700000 + 10000));
  const cnt = (kind) => { const sp = L.split(items, kind, 1), trg = new Map(); sp.train.forEach((i) => trg.set(items[i].g, (trg.get(items[i].g) || 0) + 1)); return mean(sp.test.map((i) => trg.get(items[i].g) || 0)); };
  put('sib_train_random', cnt('random'), 2); put('sib_train_lineage', cnt('lineage'), 2);
  check(Math.abs(F.sib_train_random - 2.4) < 0.15 && F.sib_train_lineage === 0, 'siblings of a test frame in the training set: random ' + F.sib_train_random + ', lineage ' + F.sib_train_lineage);
  { const seen = new Set(); let dups = 0; items.forEach((t) => { const d = L.digest(t.rec); if (seen.has(d.hx)) dups++; seen.add(d.hx); }); put('sib_hash_dups', dups, 0); check(dups === 0, 'no two sibling frames share a digest: the hash join sees nothing'); }
  /* this file's own kNN and AUC (a different formulation) against the builder's cells for seed 1 */
  const aucOwn = (pos, neg) => { let s = 0; pos.forEach((p) => neg.forEach((q) => { s += p > q ? 1 : p === q ? 0.5 : 0; })); return s / (pos.length * neg.length); };
  const knnOwn = (sp, k) => { const tr = sp.train.map((i) => items[i]), te = sp.test.map((i) => items[i]), pos = [], neg = [];
    te.forEach((t) => { const sims = tr.map((r, i) => { let d = 0; for (let q = 0; q < W; q++) d += t.f[q] * r.f[q]; return { d, i }; }); sims.sort((a, b) => (b.d - a.d) || (a.i - b.i)); let s = 0; for (let j = 0; j < k; j++) s += tr[sims[j].i].rec.y; (t.rec.y ? pos : neg).push(s / k); });
    return aucOwn(pos, neg); };
  for (const kind of ['random', 'lineage']) { const sp = L.split(items, kind, 1); const a1 = knnOwn(sp, 1), a10 = knnOwn(sp, 10);
    check(Math.abs(a1 - D.leak[1].cells[kind]['1nn']) < 2e-4 && Math.abs(a10 - D.leak[1].cells[kind]['10nn']) < 2e-4, kind + ': own kNN ' + a1.toFixed(4) + ', ' + a10.toFixed(4) + ' vs table ' + D.leak[1].cells[kind]['1nn'] + ', ' + D.leak[1].cells[kind]['10nn']); }
  lap('knn cells');
  { const sp = L.split(items, 'random', 1), model = SV.train(sp.train.map((i) => items[i].rec), { seed: 1 }), pos = [], neg = []; sp.test.forEach((i) => { (items[i].rec.y ? pos : neg).push(SV.score(model, items[i].rec.x).s); });
    const a = aucOwn(pos, neg); check(Math.abs(a - D.leak[1].cells.random.detector) < 2e-4, 'detector cell recomputed: ' + a.toFixed(4) + ' vs ' + D.leak[1].cells.random.detector); }
  lap('detector cell');
  const cell = (kind, lr) => mean([1, 2, 3].map((s) => D.leak[s].cells[kind][lr]));
  for (const lr of ['1nn', '10nn', 'detector']) { put('leak_' + lr + '_random', cell('random', lr), 3); put('leak_' + lr + '_lineage', cell('lineage', lr), 3); put('leak_' + lr + '_gap', cell('random', lr) - cell('lineage', lr), 3); }
  for (const k of D.config.leak.ks) { const g = mean([1, 2, 3].map((s) => D.leak[s].ladder[k].random - D.leak[s].ladder[k].lineage)); put('leak_ladder_' + k, g, 3); }
  [1, 2, 3].forEach((s) => put('leak_det_gap_' + s, D.leak[s].cells.random.detector - D.leak[s].cells.lineage.detector, 3));
  check(F.leak_1nn_gap > 0.1 && F.leak_10nn_gap > 0.08 && Math.abs(F.leak_detector_gap) < 0.03, 'the memorisers leak 0.15 and more, the detector 0.02 on average (' + [1, 2, 3].map((s) => F['leak_det_gap_' + s]).join(', ') + ' by seed)');
  check(F.leak_ladder_1 >= F.leak_ladder_10 - 0.01 && F.leak_ladder_10 > F.leak_ladder_30 && F.leak_ladder_30 > F.leak_ladder_100 && F.leak_ladder_100 > Math.abs(F.leak_detector_gap) - 0.01, 'the leak falls as k grows');
  put('leak_gap_min_1nn', Math.min(...[1, 2, 3].map((s) => D.leak[s].cells.random['1nn'] - D.leak[s].cells.lineage['1nn'])), 3);
  /* the seed-reuse leak: 30% of the test frames are copies of training frames */
  const rr = [1, 2, 3].map((s) => D.leak[s].reuse); put('reuse_frac', 30, 0);
  put('reuse_1nn_clean', mean(rr.map((r) => r.clean.nn1)), 3); put('reuse_1nn_dup', mean(rr.map((r) => r.reused.nn1)), 3); put('reuse_det_clean', mean(rr.map((r) => r.clean.detector)), 3); put('reuse_det_dup', mean(rr.map((r) => r.reused.detector)), 3); put('reuse_det_gain', mean(rr.map((r) => r.reused.detector - r.clean.detector)), 3); put('reuse_1nn_gain', mean(rr.map((r) => r.reused.nn1 - r.clean.nn1)), 3);
  check(F.reuse_1nn_dup - F.reuse_1nn_clean > 0.1 && Math.abs(F.reuse_det_dup - F.reuse_det_clean) < 0.05, 'seed reuse lifts the memoriser, not the detector');
  { /* a memoriser recalls every duplicated positive frame: recomputed for seed 1 */
    const sp = L.split(items, 'lineage', 1), tr = sp.train.map((i) => items[i]), te = sp.test.map((i) => items[i]), pick = L.shuffled(te.length, 1 + 31), nDup = Math.round(0.3 * te.length), rg = SV.rng(1 + 77), dupIdx = pick.slice(0, nDup);
    let nPos = 0, recalled = 0; dupIdx.forEach((i) => { const src = tr[Math.floor(rg() * tr.length)]; if (src.rec.y) { nPos++; let best = -2, by = 0; tr.forEach((r) => { let d = 0; for (let q = 0; q < W; q++) d += src.f[q] * r.f[q]; if (d > best) { best = d; by = r.rec.y; } }); if (by === 1) recalled++; } });
    put('reuse_recall', pc(recalled / nPos), 0); check(recalled === nPos, 'the 1-NN recalls every duplicated positive frame'); put('reuse_pos', nPos, 0);
  }
  lap('leaks');
}

/* ───────────── 6 · the exit: the naive program through every check ───────────── */
{
  put('exit_n', D ? D.exit.n : 1000, 0);
  if (D) { put('exit_flagged', D.exit.flagged, 0); put('exit_dup', D.exit.dup, 0); put('exit_lineage', D.exit.lineage, 0); put('exit_replay', D.exit.replay, 0); put('exit_integrity', D.exit.integrity, 0); put('exit_ped', D.exit.ped, 0); put('exit_lo', D.exit.lo, 0); put('exit_hi', D.exit.hi, 0);
    check(D.exit.flagged === 0 && D.exit.dup === 0 && D.exit.lineage === 0 && !D.exit.rateFail && D.exit.replay === 0 && D.exit.integrity === 0, 'the naive program passes the gate (table)');
    put('exit_canary_mean', mean(D.exit.canary), 3); put('exit_canary_sd', sdev(D.exit.canary), 3); }
  { const r0 = L.run(aaaa, 1000, 19680000, null), byPix = {}, byRec = {}; let pix = 0, rec = 0;      // the builder's exit run again: the pixel checksum alone collides, the pair of checksums does not
    r0.rows.forEach((r) => { if (byPix[r.hx]) pix++; else byPix[r.hx] = 1; if (byRec[r.hx + r.hy]) rec++; else byRec[r.hx + r.hy] = 1; });
    put('exit_pixel_pairs', pix, 0); put('exit_record_dups', rec, 0); if (D) check(L.batch(r0.rows, declA).dup === D.exit.dup && rec === D.exit.dup, 'the exit run recomputed: record duplicates ' + rec + ' vs table ' + (D && D.exit.dup)); }
  const run = L.run(aaaa, 400, 19895000, null), b = L.batch(run.rows, declA), au = L.audit(run, 400, SV.rng(5)); let flagged = 0; run.recs.forEach((r) => { if (L.check(r, declA).length) flagged++; });
  put('exit_fresh_n', 400, 0); put('exit_fresh_flagged', flagged, 0); check(flagged === 0 && b.dup === 0 && b.lineage === 0 && !b.fail.rate && au.replay.length === 0 && au.integrity.length === 0, 'aaaa passes the gate on a fresh run');
  const miss = T.swap.aaaa.realMiss, own = T.swap.aaaa.ownMiss; put('aaaa_miss', pc(mean(miss)), 1); put('aaaa_own_miss', pc(mean(own)), 1); put('bbba_miss', pc(mean(T.swap.bbba.realMiss)), 1);
  put('aaaa_alarm', pc(mean(T.swap.aaaa.logsAlarm)), 0);
}
lap('exit');

/* ───────────── 7 · checkpoint arithmetic ───────────── */
{
  const f = 0.005, c = 0.2, q = f * c; put('ck_q', q, 4); put('ck_k_inv', Math.ceil(Math.log(0.05) / Math.log(1 - q)), 0); put('ck_k_rep', Math.ceil(Math.log(0.05) / Math.log(1 - f)), 0);
  put('ck_look', pc(1 - Math.pow(1 - f, 100)), 0); put('ck_all', 100 * (1 - Math.pow(1 - q, 20000)), 1); put('ck_touched', f * 20000, 0);
}

/* ───────────── 8 · the widget ───────────── */
{
  const file = path.join(root, dir, '09_replay_checks_and_leaks.html');
  if (fs.existsSync(file) && D) {
    const page = loadPage(file, { dpr: 2, console: { log() {}, warn() {}, error() {} } });
    check(page.problems.length === 0, 'the page runs clean: ' + page.problems.slice(0, 2).join(' | '));
    const kOf = (x) => Math.round(Math.pow(10, x / 10));
    const closed = (f, c, k) => 1 - Math.pow(1 - f * c, k);
    const observed = (bits, k, seed) => { const rng = SV.rng(seed); let hit = 0; for (let t = 0; t < 300; t++) for (let j = 0; j < k; j++) if (bits[Math.floor(rng() * 1000)]) { hit++; break; } return hit / 300; };
    const firing = (id) => { const b = D.bench[id], Fd = L.faultById(id), r = b.run, out = [], cE = b.cAny !== undefined ? b.cAny : r.cHit;
      if (b.c) IDS.forEach((n) => { if (1 - Math.pow(1 - Fd.f * b.c[n], 1000) >= 0.95) out.push(n); }); else if (cE > 0 && 1 - Math.pow(1 - Fd.f * cE, 1000) >= 0.95) out.push('frames');
      if (r.dup > 0) out.push('dup'); if (r.lineage > 0) out.push('lineage'); if (r.rateFail) out.push('rate'); if (b.pool.fails.some((x) => x)) out.push('pool'); if (r.integrity > 0) out.push('integrity'); if (r.replay > 0) out.push('replay'); return out; };
    const cell = (kind, lr) => mean([1, 2, 3].map((s) => D.leak[s].cells[kind][lr]));
    page.set('w09-fault', 'none'); page.set('w09-k', 20);
    check(page.text('w09-f') === '—' && /none/.test(page.text('w09-fire')), 'no fault: every check is green (' + page.text('w09-fire') + ')');
    const widgetCases = [['upside', 10], ['mask', 0], ['mask', 10], ['flip', 17], ['mask', 20], ['flip', 25], ['flip', 15], ['thresh', 30], ['depth', 0], ['seeds', 12], ['stale', 20], ['drift', 5], ['rows', 20], ['read', 20], ['palette', 20], ['pped', 10]];
    for (const [id, x] of widgetCases) {
      page.set('w09-fault', id); page.set('w09-k', x);
      const b = D.bench[id], Fd = L.faultById(id), cE = b.cAny !== undefined ? b.cAny : b.run.cHit, k = kOf(x), q = Fd.f * cE;
      check(page.text('w09-f') === Math.round(100 * Fd.f) + '%', id + ': f readout ' + page.text('w09-f'));
      check(page.text('w09-c') === cE.toFixed(3), id + ': c readout ' + page.text('w09-c') + ' vs ' + cE.toFixed(3));
      check(page.text('w09-pc') === closed(Fd.f, cE, k).toFixed(3), id + ' k=' + k + ': closed-form readout ' + page.text('w09-pc') + ' vs ' + closed(Fd.f, cE, k).toFixed(3));
      check(page.text('w09-po') === observed(bitsOf(b.runBits), k, 9100 + k).toFixed(3), id + ' k=' + k + ': observed readout ' + page.text('w09-po'));
      check(page.text('w09-k95') === (q > 0 ? String(k95(q)) : 'never'), id + ': k95 readout ' + page.text('w09-k95') + ' vs ' + k95(q));
      const fr = firing(id), want = fr.length ? fr.join(', ') : 'none: nothing inside the factory fires'; check(page.text('w09-fire') === want, id + ': checks that fire "' + page.text('w09-fire') + '" vs "' + want + '"');
      put('w_' + id + '_' + x + '_pc', closed(Fd.f, cE, k), 3); put('w_' + id + '_' + x + '_po', observed(bitsOf(b.runBits), k, 9100 + k), 3);
    }
    put('flip_run_flagged', D.bench.flip.run.flagged, 0); put('flip_run_expected', 1000 * L.faultById('flip').f * D.bench.flip.cAny, 0);
    for (const lr of ['1nn', '10nn', 'detector']) for (const lin of [false, true]) {
      page.set('w09-learner', lr); page.check('w09-lineage', lin);
      check(page.text('w09-auc') === cell(lin ? 'lineage' : 'random', lr).toFixed(3), 'leak panel ' + lr + ' ' + lin + ': AUC readout ' + page.text('w09-auc'));
      const g = cell('random', lr) - cell('lineage', lr); check(page.text('w09-gap') === (g >= 0 ? '+' : '') + g.toFixed(3), 'leak panel gap readout ' + page.text('w09-gap'));
    }
    /* the page's own engine produces the same digests as this process (the vm context is a separate realm) */
    const pl = page.win.SV.l09; let eq = 0;
    for (let i = 0; i < 4; i++) { const a = L.digest(L.make(bbba, L.seedsOf(19820000 + i))), b = pl.digest(pl.make(pl.program('bbba'), pl.seedsOf(19820000 + i))); if (a.hx === b.hx && a.hy === b.hy) eq++; }
    check(eq === 4, 'the page computes the same digests as the oracle process'); put('page_digest_equal', eq, 0);
    check(page.problems.length === 0, 'the widget survives the states the prose names: ' + page.problems.slice(0, 2).join(' | '));
  } else lap('(page not written yet: widget checks skipped)');
}
lap('widget');

if (bad) { console.error(bad + ' check(s) failed'); process.exit(1); }
delete F._rows; delete F._cflag;
console.log(JSON.stringify({ facts: F }));
