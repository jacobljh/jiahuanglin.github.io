#!/usr/bin/env node
'use strict';
/* build_l04.js — measures what lesson 4 (same scene, other pixels) quotes from trained detectors, and writes all_lessons/synthetic_vision_new/l04_data.js
 *
 *   node tools/chain/verify/engine/build_l04.js --list                 print the job list
 *   node tools/chain/verify/engine/build_l04.js --job k                run job k and store its result in tools/chain/syn_notes/w04/results/<key>.json
 *   node tools/chain/verify/engine/build_l04.js --run [--jobs 2]        run every job that has no stored result, in at most 2 worker processes, then merge
 *   node tools/chain/verify/engine/build_l04.js                         merge the stored results into l04_data.js (fails if a result is missing)
 *   node tools/chain/verify/engine/build_l04.js --check                 recompute three cells live and compare them with the stored results
 *
 * Every job is a function of fixed seeds; the protocol is the one of the whole series (syn_lab.js: N training frames, threshold at 10 % false alarms on the street's
 * validation frames, miss rate over the street's test pedestrians with at least 6 visible px^2) unless the job says otherwise.  Jobs:
 *   group  the program `aaba` with a subset of the four look groups (sun direction, brightness, colours, textures) taken from the street: 14 subsets x 3 seeds
 *   width  the look of the street with every numeric range scaled by s about its centre (L.scaleLook), s = 0, 0.5, 1.5, 2, 3 x 3 seeds; s = 1 is the street's own look = the table cell abba
 *   est    the look estimated from the probe pixels of unlabelled frames (SV.l04.estimate), 3 seeds
 *   xlook  the cross-look matrix: train on one point-like look, grade on each of four
 *   curve  the program at s = 1 and s = 3 trained on N = 200, 400, 800 frames
 * The lab's privilege is used here (the street's look ranges are read from SV.REAL to build the programs a project cannot build); every estimated quantity is computed from evidence. */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const ROOT = path.resolve(__dirname, '../../../..');
const DIR = fs.existsSync(path.join(ROOT, 'all_lessons/synthetic_vision_new')) ? 'synthetic_vision_new' : 'synthetic_vision';
const LESSON = path.join(ROOT, 'all_lessons', DIR);
const OUT = path.join(LESSON, 'l04_data.js');
const RES = path.join(ROOT, 'tools/chain/syn_notes/w04/results');
const LAB = require('./syn_lab.js');
const SV = LAB.SV;
require(path.join(LESSON, 'evidence.js'));
const L = require(path.join(LESSON, 'l04_light.js'));
const argv = process.argv.slice(2), has = (f) => argv.includes(f), arg = (f, d) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : d; };

/* ── the programs ── */
const streetLook = () => SV.clone(SV.REAL.look);
/* a subset of the four look groups from the street, the rest from SIM0: mask = four characters in the order sun, bright, colour, texture */
function groupLook(mask) {
  const look = SV.clone(SV.SIM0.look), R = SV.REAL.look;
  L.GROUP_NAMES.forEach((g, i) => { if (mask[i] === '1') L.GROUPS[g].forEach((k) => { look[k] = SV.clone(R[k]); }); });
  return look;
}
/* one look parameter from the street (mode add) or every parameter but that one (mode drop); `keys` are the entries of the look configuration */
function oneLook(param, mode) {
  const R = SV.REAL.look, look = SV.clone(mode === 'add' ? SV.SIM0.look : R);
  look[param] = SV.clone((mode === 'add' ? R : SV.SIM0.look)[param]);
  return look;
}
function lookOf(spec) {
  if (spec.kind === 'group') return groupLook(spec.mask);
  if (spec.kind === 'one') return oneLook(spec.param, spec.mode);
  if (spec.kind === 'width') return lumLook(spec.s);
  if (spec.kind === 'wall' || spec.kind === 'curve') return L.scaleLook(streetLook(), spec.s);
  if (spec.kind === 'est') return L.estimatedLook(L.estimate(SV.evidence.logs(1000)), spec.parts);
  throw new Error('no look for ' + spec.kind);
}
/* the brightness of the street (lum) scaled by s about its centre, everything else SIM0's: s = 1 is the street's own range of brightness */
function lumLook(s) { const look = SV.clone(SV.SIM0.look); look.lum = L.scaleRange(SV.REAL.look.lum, s, L.LIMITS.lum); return look; }
const MASKS = []; for (let m = 1; m < 15; m++) MASKS.push([0, 1, 2, 3].map((i) => (m >> (3 - i)) & 1).join(''));          // 0000 and 1111 are the table cells aaba and abba
const SWEEP = [0, 0.5, 1, 1.5, 2, 3], SEEDS = [1, 2, 3];
/* four point-like looks, slices of the street's look space (sun elevation and azimuth in degrees, ambient fraction, brightness); the pedestrian's clothes, the van and the sky are the program's */
const XLOOKS = { noon: { sunEl: 55, sunAz: 0, amb: 0.45, lum: 1 }, low: { sunEl: 15, sunAz: 90, amb: 0.3, lum: 0.7 }, against: { sunEl: 30, sunAz: 150, amb: 0.3, lum: 0.8 }, dim: { sunEl: 55, sunAz: 0, amb: 0.45, lum: 0.15 } };
const XNAMES = Object.keys(XLOOKS), XN = 800;
const xLook = (nm) => { const look = SV.clone(SV.SIM0.look), o = XLOOKS[nm]; Object.keys(o).forEach((k) => { look[k] = [o[k], o[k]]; }); return look; };
const CURVE_N = [200, 400, 800];
const PARAMS = ['sunEl', 'sunAz', 'amb', 'lum', 'ground', 'sky', 'pedPalette', 'vanPalette', 'windows', 'stripe'];

function jobs() {
  const J = [], W = (seed) => SWEEP.forEach((sw) => J.push({ key: 'width-' + sw + '-' + seed, kind: 'width', s: sw, seed, N: 1600 }));
  const A = (seed) => SWEEP.filter((sw) => sw !== 1).forEach((sw) => J.push({ key: 'wall-' + sw + '-' + seed, kind: 'wall', s: sw, seed, N: 1600 }));
  W(1); W(2);
  for (const seed of [1, 2, 3]) J.push({ key: 'est-lum-' + seed, kind: 'est', parts: ['lum'], seed, N: 1600 });
  for (const nm of XNAMES.concat(['mixed'])) J.push({ key: 'xlook-' + nm + '-1', kind: 'xlook', train: nm, seed: 1, N: XN });
  J.push({ key: 'cnr', kind: 'cnr' });
  A(1); A(2); A(3);
  for (const N of CURVE_N) for (const sw of [1, 3]) J.push({ key: 'curve-' + sw + '-' + N + '-1', kind: 'curve', s: sw, seed: 1, N });
  for (const seed of [1, 2]) J.push({ key: 'est-lum+sky+ground-' + seed, kind: 'est', parts: ['lum', 'sky', 'ground'], seed, N: 1600 });
  W(3);
  return J;
}

/* the cross-look matrix: train on N frames of one look (or 200 of each of the four: 'mixed'), grade on each look with the threshold of that look's own pedestrian-free frames */
function execX(spec) {
  const t0 = Date.now(), prog = (nm) => L.program(xLook(nm));
  let train;
  if (spec.train === 'mixed') { train = []; XNAMES.forEach((nm, k) => SV.makeSet(prog(nm), spec.N / 4, SV.SEEDS.train + 100000 + k * 50000).forEach((f) => train.push(f))); }
  else train = SV.makeSet(prog(spec.train), spec.N, SV.SEEDS.train + 100000);
  const model = LAB.roundModel(SV.train(train, { seed: spec.seed })), miss = {};
  XNAMES.forEach((nm) => {
    const v = SV.makeSet(prog(nm), 800, SV.SEEDS.simVal), t = SV.makeSet(prog(nm), 1500, SV.SEEDS.simTest);
    const sv = SV.scoreSet(model, v), st = SV.scoreSet(model, t), thr = SV.thrAtFPR(sv.filter((_, i) => !v[i].y), SV.EXAM.fa);
    miss[nm] = +SV.exam(t, st, { thr }).miss.toFixed(4);
  });
  return { key: spec.key, kind: 'xlook', train: spec.train, N: spec.N, seed: spec.seed, miss, sec: +((Date.now() - t0) / 1000).toFixed(1) };
}
/* the recoverability line and the share of pedestrians below it.  c0: the contrast-to-noise ratio at which the detector trained on the street's range of brightness (s = 1, seed 1) finds half of the pedestrians of its own
 * program, from a logistic fit of hit against log10 CNR on 1500 frames (the seeds of the lab's own test set); share(s): the fraction of 600 pedestrians (area >= 6) of the program of width s with CNR below c0 */
function fitC0(rows) {
  let a = 0, b = 1, k, i;
  const x = rows.map((r) => Math.log10(r.cnr)), y = rows.map((r) => r.hit ? 1 : 0);
  for (k = 0; k < 50; k++) {
    let g0 = 0, g1 = 0, h00 = 0, h01 = 0, h11 = 0;
    for (i = 0; i < x.length; i++) { const p = 1 / (1 + Math.exp(-(a + b * x[i]))), w = p * (1 - p) + 1e-9, r = y[i] - p; g0 += r; g1 += r * x[i]; h00 += w; h01 += w * x[i]; h11 += w * x[i] * x[i]; }
    const det = h00 * h11 - h01 * h01, da = (h11 * g0 - h01 * g1) / det, db = (-h01 * g0 + h00 * g1) / det;
    a += da; b += db; if (Math.abs(da) + Math.abs(db) < 1e-10) break;
  }
  return { c0: Math.pow(10, -a / b), a, b };
}
const BINS = [0, 8, 12, 20, 35, 1e9];
function execCNR() {
  const t0 = Date.now(), M = require(path.join(LESSON, 'tables.js')).TABLES.models['swap@abba'], model = { dim: 110, w: M.w, mu: M.mu, sd: M.sd };
  const pipe = L.program(L.scaleLook(streetLook(), 1)), rows = [];
  for (let i = 0; i < 1500; i++) { const f = L.relight(pipe, SV.SEEDS.simTest + i, SV.SEEDS.simTest + i, SV.SEEDS.simTest + i); if (f.y && f.area >= SV.EXAM.minArea) rows.push({ cnr: L.cnr(f), hit: SV.score(model, f.x).s > M.thrOwn }); }
  const fit = fitC0(rows), bins = [];
  for (let b = 0; b + 1 < BINS.length; b++) { const a = rows.filter((r) => r.cnr >= BINS[b] && r.cnr < BINS[b + 1]); bins.push({ lo: BINS[b], hi: BINS[b + 1], n: a.length, hit: a.length ? +(a.filter((r) => r.hit).length / a.length).toFixed(4) : null }); }
  const out = { key: 'cnr', kind: 'cnr', c0: +fit.c0.toFixed(3), fit: { a: +fit.a.toFixed(4), b: +fit.b.toFixed(4) }, n: rows.length, bins, lum: {}, all: {}, dimLum: {}, dimAll: {} };
  [['lum', lumLook], ['all', (sw) => L.scaleLook(streetLook(), sw)]].forEach(([fam, look]) => {
    SWEEP.forEach((sw) => {
      const p = L.program(look(sw)), c = []; let frames = 0, dimN = 0;
      for (let i = 0; i < 4000 && c.length < 600; i++) { const f = L.relight(p, SV.SEEDS.train + 100000 + i, SV.SEEDS.train + 100000 + i, SV.SEEDS.train + 100000 + i); frames++; if (f.look.lum < 0.12) dimN++; if (f.y && f.area >= SV.EXAM.minArea) c.push(L.cnr(f)); }
      out[fam][sw] = +(c.filter((v) => v < fit.c0).length / c.length).toFixed(4); (fam === 'lum' ? out.dimLum : out.dimAll)[sw] = +(dimN / frames).toFixed(4);
    });
  });
  out.sec = +((Date.now() - t0) / 1000).toFixed(1);
  return out;
}
function exec(spec) {
  if (spec.kind === 'xlook') return execX(spec);
  if (spec.kind === 'cnr') return execCNR();
  const t0 = Date.now(), pipe = L.program(lookOf(spec));
  const r = LAB.canonPipe(pipe, spec.N, spec.seed, spec.key);
  const out = Object.assign({}, r.result, { key: spec.key, kind: spec.kind, sec: +((Date.now() - t0) / 1000).toFixed(1) });
  if (spec.seed === 1) out.model = r.model;
  return out;
}

function runJob(k) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [__filename, '--job', k], { stdio: ['ignore', 'pipe', 'inherit'] });
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.on('close', (code) => code === 0 ? resolve(out.trim()) : reject(new Error('job ' + k + ' failed')));
  });
}
async function run(list, k) {
  const only = (j) => (!has('--seed') || j.seed === +arg('--seed')) && (!has('--kind') || j.kind === arg('--kind'));
  const todo = list.map((j) => [j, j.key]).filter(([j]) => only(j) && !fs.existsSync(path.join(RES, j.key + '.json')));
  let next = 0, done = 0; const t0 = Date.now();
  await Promise.all(Array.from({ length: k }, async () => { for (;;) { const i = next++; if (i >= todo.length) return; await runJob(todo[i][1]); done++; console.error(done + '/' + todo.length + ' jobs, ' + Math.round((Date.now() - t0) / 1000) + ' s'); } }));
}

async function main() {
  fs.mkdirSync(RES, { recursive: true });
  const list = jobs();
  if (has('--list')) { list.forEach((j, i) => console.log(i, JSON.stringify(j))); return; }
  if (has('--job')) {
    const spec = list.find((j) => j.key === arg('--job')) || list[+arg('--job')];
    if (!spec) throw new Error('no such job');
    const r = exec(spec);
    fs.writeFileSync(path.join(RES, spec.key + '.json'), JSON.stringify(r));
    console.log(JSON.stringify(Object.assign({}, r, { model: undefined })));
    return;
  }
  if (has('--run')) await run(list, +arg('--jobs', 2));
  if (has('--check')) return check(list);
  merge(list);
}

/* ── merge the stored results into l04_data.js ── */
const FIELDS = ['realMiss', 'missOpen', 'missEmerge', 'realAUC', 'ownMiss', 'carriedFA', 'logsAlarm', 'domAUC', 'thrReal', 'thrOwn'];
const get = (key) => JSON.parse(fs.readFileSync(path.join(RES, key + '.json'), 'utf8'));
const cellOf = (rows) => { const o = {}; FIELDS.forEach((f) => { o[f] = rows.map((r) => r[f]); }); return o; };
const modelOf = (r) => ({ w: r.model.w, mu: r.model.mu, sd: r.model.sd, thrReal: r.thrReal, thrOwn: r.thrOwn });
function merge(list) {
  const missing = list.filter((j) => !fs.existsSync(path.join(RES, j.key + '.json'))).map((j) => j.key);
  if (missing.length) { console.error('missing results: ' + missing.join(' ')); process.exit(1); }
  const TB = require(path.join(LESSON, 'tables.js')).TABLES;
  const D = { protocol: { N: 1600, seeds: SEEDS, xN: XN, curveN: CURVE_N, widths: SWEEP }, sweep: {}, wall: {}, est: {}, xlook: {}, curve: {}, models: {} };
  SWEEP.forEach((sw) => { const rows = SEEDS.map((k) => get('width-' + sw + '-' + k)); D.sweep[sw] = cellOf(rows); D.models['sweep@' + sw] = modelOf(rows[0]); });
  SWEEP.forEach((sw) => {
    if (sw === 1) { D.wall[1] = TB.swap.abba; const m = TB.models['swap@abba']; D.models['wall@1'] = { w: m.w, mu: m.mu, sd: m.sd, thrReal: m.thrReal, thrOwn: m.thrOwn }; return; }
    const rows = SEEDS.map((k) => get('wall-' + sw + '-' + k)); D.wall[sw] = cellOf(rows); D.models['wall@' + sw] = modelOf(rows[0]);
  });
  for (const parts of [['lum'], ['lum', 'sky', 'ground']]) { const nm = parts.join('+'), rows = (parts.length === 1 ? SEEDS : [1, 2]).map((k) => get('est-' + nm + '-' + k)); D.est[nm] = cellOf(rows); if (nm === 'lum') D.models['est@lum'] = modelOf(rows[0]); }
  D.est['lum+sky'] = cellOf([get('est-lum+sky-1')]);
  const sw1 = L.estimate(SV.evidence.logs(1000));
  D.estimate = { lum: sw1.lum, G: sw1.G, sky: sw1.sky, used: sw1.used, look: L.estimatedLook(sw1, ['lum', 'sky', 'ground']) };
  XNAMES.concat(['mixed']).forEach((nm) => { D.xlook[nm] = get('xlook-' + nm + '-1').miss; });
  D.xlook.names = XNAMES; D.xlook.looks = XLOOKS;
  [1, 3].forEach((sw) => { D.curve[sw] = {}; CURVE_N.forEach((N) => { D.curve[sw][N] = cellOf([get('curve-' + sw + '-' + N + '-1')]); }); D.curve[sw][1600] = D.wall[sw]; });
  const c = get('cnr'); D.cnr = { c0: c.c0, fit: c.fit, n: c.n, bins: c.bins, lum: c.lum, all: c.all, dimLum: c.dimLum, dimAll: c.dimAll };
  const body = '/* l04_data.js — measured by tools/chain/verify/engine/build_l04.js (do not edit by hand).  Every cell is a function of fixed seeds.\n' +
    ' * sweep[s]  the program whose brightness is the street\'s range scaled by s about its centre (everything else SIM0\'s), N = 1600, seeds 1-3;  wall[s]  every numeric range of the street\'s look scaled by s (s = 1 is the table cell abba);\n' +
    ' * est[parts]  programs whose look is read from the probes of 1000 unlabelled frames;  xlook  the cross-look matrix (train row, grade column);  curve[s][N]  learning curves of wall[s];\n' +
    ' * cnr  the recoverability line c0, its psychometric table and the shares of pedestrians below it for both families;  models  seed-1 detectors */\n' +
    '(function (root) {\n  var SV = root.SV || (root.SV = {});\n  SV.L04 = ' + JSON.stringify(D) + ';\n})(typeof window !== \'undefined\' ? window : (typeof globalThis !== \'undefined\' ? globalThis : this));\n' +
    'if (typeof module !== \'undefined\' && module.exports) module.exports = (typeof globalThis !== \'undefined\' ? globalThis : this).SV;\n';
  fs.writeFileSync(OUT, body);
  console.log('wrote ' + path.relative(ROOT, OUT) + ' (' + body.length + ' bytes)');
}
async function check(list) {
  delete global.SV; require(OUT);
  const D = (global.SV || globalThis.SV).L04; let bad = 0;
  for (const key of ['width-1.5-2', 'est-lum-3', 'xlook-dim-1']) {
    const spec = list.find((j) => j.key === key), r = exec(spec);
    if (spec.kind === 'xlook') { XNAMES.forEach((nm) => { if (Math.abs(D.xlook[spec.train][nm] - r.miss[nm]) > 1e-9) { bad++; console.error('MISMATCH', key, nm); } }); continue; }
    const stored = spec.kind === 'width' ? D.sweep[spec.s] : spec.kind === 'wall' ? D.wall[spec.s] : D.est[spec.parts.join('+')];
    ['realMiss', 'ownMiss', 'logsAlarm'].forEach((f) => { if (Math.abs(stored[f][spec.seed - 1] - r[f]) > 1e-9) { bad++; console.error('MISMATCH', key, f, stored[f][spec.seed - 1], r[f]); } });
  }
  console.log(bad ? bad + ' mismatches' : 'l04_data.js agrees with a live recomputation of three cells');
  process.exit(bad ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
