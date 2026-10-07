#!/usr/bin/env node
'use strict';
/* build_l08.js — measures Lesson 8's tables (the contract in a real renderer) and writes all_lessons/synthetic_vision/l08_data.js
 *
 *   node tools/chain/verify/engine/build_l08.js [--jobs 2]          every job whose result is missing (Blender renders, trainings), at most --jobs worker processes at once and Blender never twice at a time, then the merge
 *   node tools/chain/verify/engine/build_l08.js --job suite         the conformance suite in Blender (tools/syn_blender/render_suite.py)                      -> w08/cache/suite.json
 *   node tools/chain/verify/engine/build_l08.js --job cost          timings, samples against error, EEVEE (render_cost.py, three sessions)                   -> w08/cache/cost.json
 *   node tools/chain/verify/engine/build_l08.js --job frames        the 24 scenes (entry build, every clause set, other sample pattern, 1024 samples) and two scenes along the path k = 0 ... 12
 *   node tools/chain/verify/engine/build_l08.js --job train:TAG     render in Blender (once, cached in w08/cache) and train/grade one design; TAG: all_s1 all_s2 all_s3 def_all def_rows def_lens def_shift def_filter def_output def_flat
 *                                                                    def_base def_denoise def_mask x_rows5 x_rows25 (rows reversed in 5 / 25 % of the frames)
 *   node tools/chain/verify/engine/build_l08.js --merge             rewrites l08_data.js from the job files and the Blender cache
 *   node tools/chain/verify/engine/build_l08.js --check             recomputes cells from the stored models (and re-renders a frame in Blender when it is installed) and compares them with l08_data.js
 *
 * The designs.  The program is the exact-stage program bbba of Lesson 5 (the street's scene, light and camera; the program's own label rule), N = 1,600 frames, the series' fixed detector and exam, with its RENDERER
 * replaced: scene and light are drawn exactly as SV.sample draws them (same seeds), Blender renders the radiance with the contract's settings (tools/syn_blender), the sensor of Lesson 3 stays ours (SV.sense, the same
 * noise stream as the Street's own frame of that seed) and the pedestrian's coverage comes from Blender's holdout alpha: the only difference from the Street-rendered cell bbba of tables.js is the renderer.
 * A def_* design leaves ONE clause at Blender's default and sets the others (def_all leaves every setting at its default except the pose, the buffer order and the sample count).  An x_rows* design takes the
 * all_s1 frames and writes a share of them bottom row first (image and mask together), as a second worker with another script would.
 * Every number is a function of fixed seeds and of the recorded Blender renders (the timings of the cost section are recorded measurements); there is no Math.random, and Date is used only to record seconds.  Big arrays stay in w08/cache (not shipped); the page carries what it needs. */
const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const ROOT = path.resolve(__dirname, '../../../..');
const DIR = path.join(ROOT, 'all_lessons/synthetic_vision');
const SV = require(path.join(DIR, 'street.js'));
require(path.join(DIR, 'tables.js'));
const L = require(path.join(DIR, 'l08_blender.js'));
const Lab = require('./syn_lab.js');
const W8 = path.join(ROOT, 'tools/chain/syn_notes/w08'), CACHE = path.join(W8, 'cache'), JOBS = path.join(W8, 'jobs'), SCEN = path.join(W8, 'scenes');
const OUT = path.join(DIR, 'l08_data.js');
const BLENDER = process.env.BLENDER || '/Applications/Blender.app/Contents/MacOS/Blender';
const PY = path.join(ROOT, 'tools/syn_blender');
const r5 = (x) => +Number(x).toPrecision(5), r4 = (x) => (x === null || x === undefined || !isFinite(x)) ? null : +x.toFixed(4);
const argv = process.argv.slice(2), has = (f) => argv.includes(f), arg = (f, d) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : d; };
const HW = SV.CAM.W * SV.CAM.H, N0 = 1600, SEED_BLOCK = 18000000;
[CACHE, JOBS, SCEN].forEach((d) => fs.mkdirSync(d, { recursive: true }));
const rd = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));

/* ───────────── Blender, one process at a time on this machine ───────────── */
const LOCK = path.join(W8, 'blender.lock');
function sleep(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }
function withBlender(fn) {
  for (let i = 0; ; i++) { try { fs.mkdirSync(LOCK); break; } catch (e) { if (i > 7200) throw new Error('blender lock'); sleep(1000); } }
  try { return fn(); } finally { fs.rmdirSync(LOCK); }
}
function blender(script, args, tag) {
  return withBlender(() => {
    const r = spawnSync(BLENDER, ['--background', '--factory-startup', '--python', path.join(PY, script), '--'].concat(args), { encoding: 'utf8', maxBuffer: 1 << 28 });
    const bad = (r.stdout + r.stderr).split('\n').filter((l) => /Traceback|Error:|rror: /.test(l)).slice(0, 12).join('\n');
    if (r.status !== 0 || bad) { console.error('blender ' + tag + ' failed:\n' + bad); if (r.status !== 0) process.exit(1); }
  });
}
function batch(tag, descs, k, over, want) {
  const pre = path.join(CACHE, tag);
  if (fs.existsSync(pre + '.bin') && fs.existsSync(pre + '.json')) return pre;
  const sf = path.join(SCEN, tag + '.json'); fs.writeFileSync(sf, JSON.stringify(descs));
  blender('render_frames.py', ['--desc', sf, '--out', pre, '--k', String(k), '--over', JSON.stringify(over), '--want', want, '--log', path.join(W8, 'render.log')], tag);
  return pre;
}

/* ───────────── the designs ───────────── */
const DEF_ALL = { lens: 50.0, fit: 'AUTO', shift_y: 0.0, placement: 'base', shading: 'flat', output: 'png8_agx', filter: 'BLACKMAN_HARRIS', fwidth: 1.5, mask: 'object_index', denoise: true };
const OVER = { def_all: DEF_ALL, def_rows: { rows: 'bottom_first' }, def_lens: { lens: 50.0, fit: 'AUTO' }, def_shift: { shift_y: 0.0 }, def_filter: { filter: 'BLACKMAN_HARRIS', fwidth: 1.5 }, def_output: { output: 'png8_agx' },
  def_flat: { shading: 'flat' }, def_base: { placement: 'base' }, def_denoise: { denoise: true }, def_mask: { mask: 'object_index' } };
const TRAIN = ['all_s1', 'all_s2', 'all_s3', 'def_all', 'def_rows', 'def_lens', 'def_shift', 'def_filter', 'def_output', 'def_flat', 'def_base', 'def_denoise', 'def_mask', 'x_rows5', 'x_rows25'];
function designOf(tag) {
  let m;
  if ((m = /^all_s([123])$/.exec(tag))) return { seed: +m[1], over: {}, n: N0, seed0: SV.SEEDS.train + +m[1] * 100000 };
  if (OVER[tag]) return { seed: 1, over: OVER[tag], n: N0, seed0: SV.SEEDS.train + 100000 };
  if ((m = /^x_rows(\d+)$/.exec(tag))) return { seed: 1, over: {}, n: N0, seed0: SV.SEEDS.train + 100000, base: 'all_s1', flipPct: +m[1] };
  throw new Error('unknown design ' + tag);
}
const seedsOf = (des) => Array.from({ length: des.n }, (_, i) => des.seed0 + i);

/* frames for the detector: x = the sensor of the street's camera applied to Blender's radiance (the Street's own noise stream of that seed), cov = Blender's coverage, y = the program's label rule (kvis = 1) */
function flipRows(a, planes) { const W = SV.CAM.W, H = SV.CAM.H, o = new Float32Array(a.length); for (let c = 0; c < planes; c++) for (let j = 0; j < H; j++) o.set(a.subarray(c * HW + (H - 1 - j) * W, c * HW + (H - j) * W), c * HW + j * W); return o; }
function framesFrom(pre, seeds, o) {
  o = o || {};
  const B = L.readBin(pre), N = seeds.length, out = new Array(N), sensor = SV.REAL.sensor, flip = o.flip || (() => false);
  for (let i = 0; i < N; i++) {
    let rad = B.rad.data.slice(i * 3 * HW, (i + 1) * 3 * HW), cov = B.cov.data.slice(i * HW, (i + 1) * HW);
    if (flip(i)) { rad = flipRows(rad, 3); cov = flipRows(cov, 1); }
    const x = SV.sense(rad, sensor, SV.stream(seeds[i], 'sensor')); let a = 0; for (let q = 0; q < HW; q++) a += cov[q];
    out[i] = { x: x, cov: cov, y: a >= 1 ? 1 : 0, area: a, seed: seeds[i] };
  }
  return out;
}
/* the exam of the series (syn_lab.canonPipe): threshold at 10 % false alarms on the real validation frames, miss rate over real-test pedestrians with >= 6 visible px^2 */
function exam(model, seed, tag) {
  const R = Lab.real(), sT = SV.scoreSet(model, R.test), sV = SV.scoreSet(model, R.val), negs = (set, sc) => sc.filter((_, i) => !set[i].y);
  const thr = SV.thrAtFPR(negs(R.val, sV), SV.EXAM.fa), ex = SV.exam(R.test, sT, { thr: thr });
  const byMode = (mode) => { let k = 0, n = 0; R.test.forEach((s, i) => { if (s.y && s.area >= SV.EXAM.minArea && s.mode === mode) { n++; if (sT[i] > thr) k++; } }); return n ? 1 - k / n : null; };
  return { tag: tag, seed: seed, realMiss: r4(ex.miss), missOpen: r4(byMode('open')), missEmerge: r4(byMode('emerge')), realAUC: r4(ex.auc), realN: ex.n, thrReal: r5(thr) };
}
function trainJob(tag) {
  const des = designOf(tag), seeds = seedsOf(des), t0 = Date.now(), descs = () => seeds.map((s) => L.describe(s));
  let frames;
  if (des.base) {                                            // the all-set frames, a share written with the rows reversed (image and mask together): the first `pct` of every hundred frames
    const pre = batch(des.base, descs(), 12, {}, 'rad,cov'); frames = framesFrom(pre, seeds, { flip: (i) => (i % 100) < des.flipPct });
  } else frames = framesFrom(batch(tag, descs(), 12, des.over, 'rad,cov'), seeds);
  const model = Lab.roundModel(SV.train(frames, { seed: des.seed })), res = exam(model, des.seed, tag);
  let np = 0; frames.forEach((f) => { if (f.y) np++; }); res.nPed = np; res.sec = +((Date.now() - t0) / 1000).toFixed(0);
  fs.writeFileSync(path.join(JOBS, tag + '.json'), JSON.stringify({ result: res, model: model }));
  console.log(JSON.stringify(res));
}

/* ───────────── the 24 scenes, and two scenes along the path from the defaults to conformance ───────────── */
const SEEDS24 = Array.from({ length: 24 }, (_, i) => SEED_BLOCK + i);
function framesJob() {
  const descs = SEEDS24.map((s) => L.describe(s)); fs.writeFileSync(path.join(SCEN, 'frames24.json'), JSON.stringify(descs));
  batch('cmp24_k12', descs, 12, {}, 'rad,cov,amod'); batch('cmp24_k2', descs, 2, {}, 'rad,cov'); batch('cmp24_k12b', descs, 12, { seed: 7 }, 'rad'); batch('cmp24_k12hi', descs, 12, { samples: 1024 }, 'rad,cov');
  const a = descs.findIndex((d) => d.ped && d.mode === 'open' && d.parts.some((p) => p.cls === 'tree' || p.cls === 'pole') && d.parts.find((p) => p.cls === 'ped').z < 17), b = descs.findIndex((d) => d.ped && d.mode === 'emerge');
  if (a < 0 || b < 0) throw new Error('no path scenes');
  for (let k = 0; k <= 12; k++) batch('path_k' + k, [descs[a], descs[b]], k, {}, 'rad,cov');
  fs.writeFileSync(path.join(JOBS, 'path_pick.json'), JSON.stringify({ a: a, b: b, seeds: [SEEDS24[a], SEEDS24[b]] }));
}

/* ───────────── the merge ───────────── */
const rn = (a, nd) => Array.isArray(a) ? a.map((x) => rn(x, nd)) : +(+a).toFixed(nd === undefined ? 5 : nd);
const cols = (img) => { const o = new Array(SV.CAM.W).fill(0); img.forEach((r) => r.forEach((v, u) => { o[u] += v; })); return o; };
const rowMean = (img, v0, v1) => { const W = img[0].length, n = v1 - v0, o = new Array(W).fill(0); for (let v = v0; v < v1; v++) for (let u = 0; u < W; u++) o[u] += img[v][u] / n; return o; };
const colOf = (img, u) => img.map((r) => r[u]);
const f32b64 = (arr) => { const b = Buffer.alloc(4 * arr.length); arr.forEach((v, i) => b.writeFloatLE(v, 4 * i)); return b.toString('base64'); };
const win = (img, u0, u1) => img.map((r) => r.slice(u0, u1));
function reduceSuite(S) {
  const o = {};
  o.axes = {}; ['default_camera', 'street', 'mirrored'].forEach((v) => { o.axes[v] = { red: rn(cols(S.T01[v].red), 4), green: rn(cols(S.T01[v].green), 4) }; });
  o.lens = {}; ['default', 'set', 'portrait_auto', 'portrait_horizontal'].forEach((v) => { const hz = S.T02[v].red.length === 24 ? 9 : 48; o.lens[v] = { red: rn(rowMean(S.T02[v].red, hz - 6, hz - 1), 5), green: rn(rowMean(S.T02[v].green, hz - 6, hz - 1), 5) }; });
  o.shift = { default: rn(colOf(S.T03.default.rad, 48), 5), set: rn(colOf(S.T03.set.rad, 48), 5) };
  o.rows = { default: rn(colOf(S.T05.default.rad, 48), 5), set: rn(colOf(S.T05.set.rad, 48), 5) };
  o.centre = { set: rn(S.T04.set.rad[12], 5) };
  o.filter = {}; Object.keys(S.T06).forEach((k) => { o.filter[k] = { esf: rn(S.T06[k].esf, 5) }; if (S.T06[k].sliver) o.filter[k].sliver = rn(S.T06[k].sliver, 5); });
  o.output = {}; Object.keys(S.T07).forEach((k) => { o.output[k] = rn(S.T07[k].patches, 6); });
  o.sampler = {}; Object.keys(S.T08).forEach((k) => { if (k === 'facts') { o.sampler.facts = S.T08.facts; return; } const r = S.T08[k].rad; o.sampler[k] = { w40: rn(r.slice(36, 45), 5), w20: rn(r.slice(16, 25), 5), sec: +S.T08[k].sec.toFixed(4) }; });
  o.shapes = {}; Object.keys(S.T09).forEach((k) => { const v = S.T09[k]; o.shapes[k] = k.startsWith('placement') ? { col: rn(v.col, 5) } : k.startsWith('shading') ? { row: rn(v.row, 5), desc: v.desc } : { row: rn(v.row, 5) }; });
  const T10 = S.T10.set; o.depth = { z: f32b64(T10.z.flat()), mist: f32b64(T10.mist.flat()), mist_start: T10.mist_start, mist_depth: T10.mist_depth, mist_falloff: T10.mist_falloff, sky: S.T10.sky };
  o.mask = {}; ['holdout_alpha', 'object_index', 'cryptomatte'].forEach((k) => { const c = S.T11[k].cov; o.mask[k] = { A: rn(win(c, 36, 45), 4), B: rn(win(c, 56, 65), 4), C: rn(win(c, 16, 27), 4) }; });
  o.units = { metre: S.T12.metre, centimetre: S.T12.centimetre };
  o.facts = { blender: S.blender, crypto: S.T11.facts, version: S.blender_version };
  return o;
}
function pack12(a) {                                         // 12-bit codes of the display value L^(1/2.2), two codes in three bytes
  const n = a.length, bytes = Buffer.alloc(Math.ceil(n * 1.5)), code = (v) => Math.round(Math.pow(Math.min(1, Math.max(0, v)), 1 / 2.2) * 4095);
  for (let i = 0; i < n; i += 2) { const x = code(a[i]), y = i + 1 < n ? code(a[i + 1]) : 0, o = i * 1.5; bytes[o] = x >> 4; bytes[o + 1] = ((x & 15) << 4) | (y >> 8); bytes[o + 2] = y & 255; }
  return bytes.toString('base64');
}
function packFrames() {
  const pp = rd(path.join(JOBS, 'path_pick.json')), descs = rd(path.join(SCEN, 'frames24.json')), out = { seeds: pp.seeds, desc: [descs[pp.a], descs[pp.b]], index: [[], []], data: [[], []] };
  for (let k = 0; k <= 12; k++) {
    const B = L.readBin(path.join(CACHE, 'path_k' + k));
    for (let j = 0; j < 2; j++) { const s = pack12(B.rad.data.subarray(j * 3 * HW, (j + 1) * 3 * HW)); let ix = out.data[j].indexOf(s); if (ix < 0) { out.data[j].push(s); ix = out.data[j].length - 1; } out.index[j].push(ix); }
  }
  return out;
}
function cmp24() {
  const descs = rd(path.join(SCEN, 'frames24.json')), S16 = descs.map((d) => L.streetRender(d, 16)), S2 = descs.map((d) => L.streetRender(d, 2));
  const get = (tag, key) => { const B = L.readBin(path.join(CACHE, tag)), pl = key === 'rad' ? 3 : 1; return Array.from({ length: B.meta.n }, (_, i) => B[key].data.subarray(i * pl * HW, (i + 1) * pl * HW)); };
  const st = (es) => { const s = L.stats(es); return { mean: s.mean, p99: s.p99, max: s.max, over: s.over }; };
  const k2 = get('cmp24_k2', 'rad'), k12 = get('cmp24_k12', 'rad'), k12b = get('cmp24_k12b', 'rad'), hi = get('cmp24_k12hi', 'rad');
  const o = { entry: st(k2.map((r, i) => L.errMap(r, S16[i].rad))), set: st(k12.map((r, i) => L.errMap(r, S16[i].rad))), setVsSt2: st(k12.map((r, i) => L.errMap(r, S2[i].rad))), st2: st(S2.map((r, i) => L.errMap(r.rad, S16[i].rad))),
    noise: st(k12.map((r, i) => L.errMap(r, k12b[i]))), conv: st(k12.map((r, i) => L.errMap(r, hi[i]))), sys: st(hi.map((r, i) => L.errMap(r, S16[i].rad))) };
  const cov = get('cmp24_k12', 'cov'), amod = get('cmp24_k12', 'amod'), rel = [], relA = [];
  descs.forEach((d, i) => { if (!d.ped) return; const a = L.streetRender(d, 16), f = L.streetRender(d, 16, { only: 'ped' }); let sa = 0, sb = 0, fa = 0, fb = 0; for (let q = 0; q < HW; q++) { sa += a.cov[q]; sb += cov[i][q]; fa += f.cov[q]; fb += amod[i][q]; } if (sa >= SV.EXAM.minArea) rel.push(Math.abs(sb - sa) / sa); relA.push(Math.abs(fb - fa) / fa); });
  const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  o.cov = { n: rel.length, mean: mean(rel), max: Math.max.apply(null, rel), nAmodal: relA.length, meanAmodal: mean(relA), maxAmodal: Math.max.apply(null, relA) };
  return o;
}
function merge() {
  const D = { blender: '5.2.2 LTS', clauses: L.CLAUSES.map((c) => c.id) };
  D.suite = reduceSuite(rd(path.join(CACHE, 'suite.json')));
  const cost = rd(path.join(CACHE, 'cost.json')); D.cost = { sec: cost.sec_frame, spp: cost.spp_curve, eevee: cost.eevee, worldDiff: cost.world_map_maxdiff, batch: {} };
  ['all_s1', 'all_s2', 'all_s3', 'def_denoise'].forEach((t) => { const f = path.join(CACHE, t + '.json'); if (fs.existsSync(f)) D.cost.batch[t] = +rd(f).meta.seconds.toFixed(1); });      // wall seconds of the 1,600-frame batches, as the renders recorded them
  D.frames = packFrames(); D.cmp = cmp24();
  D.exam = { designs: {}, models: {} };
  TRAIN.forEach((t) => { const f = path.join(JOBS, t + '.json'); if (!fs.existsSync(f)) return; const j = rd(f); D.exam.designs[t] = Object.assign({}, j.result); delete D.exam.designs[t].sec; D.exam.models[t] = { w: j.model.w, mu: j.model.mu, sd: j.model.sd }; });
  const body = '/* l08_data.js — recorded by tools/chain/verify/engine/build_l08.js from Blender ' + D.blender + ' (do not edit by hand).  Every cell is a function of fixed seeds and of the recorded Blender renders.\n' +
    ' * suite  : the conformance suite, reduced to the arrays each test measures (a profile, a window, a patch); SV.l08.measure turns it into the errors of the page.\n' +
    ' * frames : two scenes (description + 12-bit radiance frames recorded with the first k clauses set, k = 0 ... 12, identical frames stored once: index[scene][k]).\n' +
    ' * cmp    : the 24 scenes: error statistics (mean, 99th percentile, share of pixels over 1 %) of the entry build, of the all-set build, of the Street\'s own 2x2 pixel, of two sample patterns, and mask areas.\n' +
    ' * cost   : seconds per frame, the samples-against-error curve, EEVEE (timings recorded on the machine that built this file).\n' +
    ' * exam   : designs{tag: miss rates on the street, 3 seeds for all_s*, 1 seed otherwise}, models{tag: weights of the trained detector, 5 significant digits}. */\n' +
    '(function (root) {\n"use strict";\nvar SV = root.SV;\nSV.L08 = ' + JSON.stringify(D) + ';\n})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this));\n' +
    'if (typeof module !== "undefined" && module.exports) module.exports = (typeof globalThis !== "undefined" ? globalThis : this).SV;\n';
  fs.writeFileSync(OUT, body); console.log('wrote', OUT, body.length, 'bytes');
}

/* ───────────── check: recompute cells and compare ───────────── */
function check() {
  delete require.cache[require.resolve(OUT)]; require(OUT); const D = SV.L08, R = Lab.real(); let bad = 0;
  ['all_s1', 'def_lens'].forEach((t) => {
    const m = D.exam.models[t], model = { dim: SV.DIM, w: m.w, mu: m.mu, sd: m.sd }, e = exam(model, 1, t);
    const ok = Math.abs(e.realMiss - D.exam.designs[t].realMiss) < 1e-4; if (!ok) bad++; console.log(t, 'stored', D.exam.designs[t].realMiss, 'recomputed', e.realMiss, ok ? 'ok' : 'DIFFERENT');
  });
  if (fs.existsSync(BLENDER)) {                                // re-render two frames of the path and compare the 12-bit codes
    const descs = rd(path.join(SCEN, 'frames24.json')), pp = rd(path.join(JOBS, 'path_pick.json')), sf = path.join(SCEN, 'check.json'), pre = path.join(CACHE, 'check');
    fs.writeFileSync(sf, JSON.stringify([descs[pp.a]])); try { fs.unlinkSync(pre + '.bin'); } catch (e) { /* none */ }
    blender('render_frames.py', ['--desc', sf, '--out', pre, '--k', '12', '--want', 'rad'], 'check');
    const B = L.readBin(pre), s = pack12(B.rad.data.subarray(0, 3 * HW)), ok = s === D.frames.data[0][D.frames.index[0][12]]; if (!ok) bad++; console.log('re-rendered frame (all set) equals the recorded one:', ok);
  }
  process.exit(bad ? 1 : 0);
}

if (has('--job')) {
  const j = arg('--job');
  if (j === 'suite') blender('render_suite.py', ['--out', path.join(CACHE, 'suite.json')], 'suite');
  else if (j === 'cost') {                                    // three Blender sessions, so that no measurement inherits the state of another; merged into cost.json
    framesJob(); const parts = ['timing', 'spp', 'eevee'], res = {};
    parts.forEach((q) => { const f = path.join(CACHE, 'cost_' + q + '.json'); blender('render_cost.py', ['--desc', path.join(SCEN, 'frames24.json'), '--out', f, '--part', q], 'cost_' + q); Object.assign(res, rd(f)); });
    fs.writeFileSync(path.join(CACHE, 'cost.json'), JSON.stringify(res));
  }
  else if (j === 'frames') framesJob();
  else if (j.startsWith('train:')) trainJob(j.slice(6));
  else throw new Error('unknown job ' + j);
} else if (has('--merge')) merge();
else if (has('--check')) check();
else {
  const k = +arg('--jobs', 2); let next = 0;
  const tasks = ['suite', 'frames', 'cost'].filter((t) => !fs.existsSync(path.join(CACHE, t === 'frames' ? 'cmp24_k12.bin' : t + '.json'))).concat(TRAIN.filter((t) => !fs.existsSync(path.join(JOBS, t + '.json'))).map((t) => 'train:' + t));
  const run = (t) => new Promise((res) => { const p = spawn(process.execPath, [__filename, '--job', t], { stdio: ['ignore', 'inherit', 'inherit'] }); p.on('exit', () => res()); });
  Promise.all(Array.from({ length: k }, async () => { for (;;) { const i = next++; if (i >= tasks.length) return; await run(tasks[i]); } })).then(() => { merge(); });
}
