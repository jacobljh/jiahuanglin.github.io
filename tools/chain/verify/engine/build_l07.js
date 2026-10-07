#!/usr/bin/env node
'use strict';
/* build_l07.js — the tables of Lesson 7 (what the label means): detectors retrained under other label variants, the same detectors and the series' detectors scored under many rules, and the
 * per-pedestrian columns of the real test set.  Writes all_lessons/synthetic_vision/l07_data.js (SV.L07).  Deterministic (fixed seeds), re-runnable.
 *
 *   node tools/chain/verify/engine/build_l07.js [--jobs 2]     runs every job in worker processes (at most --jobs at once), then merges
 *   node tools/chain/verify/engine/build_l07.js --job amodal   one job, written to tools/chain/syn_notes/w07/jobs/amodal.json
 *                                                               (jobs: modal rel15 rel50 amodal shift05 shift10 fine ray soft = nine label variants x three seeds; ped; scene)
 *   node tools/chain/verify/engine/build_l07.js --merge        rewrites l07_data.js from the job files
 *   node tools/chain/verify/engine/build_l07.js --check        recomputes the amodal seed-1 cell from scratch and compares it with l07_data.js
 *
 * The program every variant trains on is the exact-stage program of Lesson 5, bbba (the street's scene, light and camera, the program's own label rule); only the LABEL stage differs:
 *   modal    the program's label: any visible pixel counts, cells are labelled from the visible mask      (= the bbba cells of tables.js)
 *   rel15    the street's label: at least 15% of the silhouette must show                                    (= the bbbb cells)
 *   rel50    at least half of the silhouette must show
 *   amodal   the mask is the whole silhouette, hidden part included
 *   shift05  the mask is displaced by half a pixel in both directions;  shift10: by one pixel
 *   fine     the visible mask counted with 8 x 8 rays per pixel instead of 2 x 2
 *   ray      the visible mask from one ray through each pixel centre (an object-index pass)
 *   soft     the visible mask softened by the default pixel filter of Blender 5.2 (an extra Gaussian blur, L.SIG_X)
 * Every variant: N = 1,600 frames, seeds 1..3 (the canonical training sets of the series), the exam of the series (threshold = 10% false alarms on real validation frames without a pedestrian).
 * Budget: 27 trainings.  Seeds of the private sets start at 17,000,000. */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const ROOT = path.resolve(__dirname, '../../../..');
const DIR = path.join(ROOT, 'all_lessons/synthetic_vision');
const SV = require(path.join(DIR, 'street.js'));
require(path.join(DIR, 'tables.js'));
const L = require(path.join(DIR, 'l07_labels.js'));
const L6 = require(path.join(DIR, 'l06_rare.js'));
const SMOKE = !!process.env.L07_SMOKE;                                   // a tiny run to test the code paths (never merged into the page's data)
const JOBDIR = path.join(ROOT, 'tools/chain/syn_notes/w07/' + (SMOKE ? 'jobs_smoke' : 'jobs'));
const OUT = path.join(DIR, 'l07_data.js');
const N0 = SMOKE ? 60 : 1600, SEEDS = SMOKE ? [1, 2] : [1, 2, 3], NT = SMOKE ? 200 : 3000, NV = SMOKE ? 100 : 1500, SEED_R = 16500000, NR = SMOKE ? 80 : 3000, S_SCENE = 17000000, NS = SMOKE ? 300 : 40000, ND = SMOKE ? 3000 : 1000000;
const r5 = (x) => +Number(x).toPrecision(5), r4 = (x) => (x === null || x === undefined || !isFinite(x)) ? null : +x.toFixed(4), r2 = (x) => +x.toFixed(2);
const argv = process.argv.slice(2), has = (f) => argv.includes(f), arg = (f, d) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : d; };

const VARIANTS = {
  modal: { pick: 'bbba', strip: null },
  rel15: { pick: 'bbbb', strip: null },
  rel50: { pick: 'bbba', label: { kvis: 1, rel: 0.5 }, strip: null },
  amodal: { pick: 'bbba', strip: L.ARMS.amodal },
  shift05: { pick: 'bbba', strip: L.ARMS.shift05 },
  shift10: { pick: 'bbba', strip: L.ARMS.shift10 },
  fine: { pick: 'bbba', strip: L.ARMS.fine },
  ray: { pick: 'bbba', strip: L.ARMS.ray },
  soft: { pick: 'bbba', strip: L.ARMS.soft }
};
const pipeOf = (v) => { const p = {}; ['scene', 'look', 'sensor', 'label'].forEach((k, i) => { p[k] = v.pick[i]; }); const pipe = SV.hybrid(SV.SIM0, SV.REAL, p); if (v.label) pipe.label = SV.clone(v.label); return pipe; };

/* ── the real sets, built once per process: lean frames plus what the grading needs (masks of the pedestrian frames, the van's neighbourhood in the pedestrian-free ones) ── */
let _S = null;
function sets() {
  if (_S) return _S;
  const C = SV.CAM, nu = Math.ceil(C.W / SV.STEP), nv = Math.ceil(C.H / SV.STEP);
  const lean = (f) => ({ x: f.x, y: f.y, area: f.area, full: f.full, mode: f.mode, ped: !!f.scene.ped, z: f.scene.ped ? f.scene.ped.parts[0].z : 0 });
  const test = [], val = [];
  for (let i = 0; i < NT; i++) {
    const f = SV.sample(SV.REAL, SV.SEEDS.test + i), g = lean(f);
    if (f.scene.ped) { g.cov = f.cov; g.sil = L.cover(f.scene, { only: 'ped' }); }
    else if (f.scene.van) {                                                       // the cells within two pixels of the van
      const vid = f.scene.van.id, near = new Uint8Array(nu * nv);
      for (let c = 0; c < nu * nv; c++) { const p = L.cellPixel(c, nu); let on = false; for (let a = -2; a <= 2 && !on; a++) for (let b = -2; b <= 2; b++) { const u = p.u + a, v = p.v + b; if (u >= 0 && u < C.W && v >= 0 && v < C.H && f.id[v * C.W + u] === vid) { on = true; break; } } near[c] = on ? 1 : 0; }
      g.vanNear = near;
    }
    test.push(g);
  }
  for (let i = 0; i < NV; i++) { const f = SV.sample(SV.REAL, SV.SEEDS.val + i); val.push({ x: f.x, y: f.y }); }
  const R = []; for (let i = 0; i < NR; i++) { const f = L6.sample(SV.REAL, SEED_R + i, 'R'); R.push({ x: f.x, y: f.y, area: f.area, full: f.full }); }     // Lesson 6's rare slice (same frames)
  _S = { test, val, R, nu, nv, ped: test.map((f, i) => i).filter((i) => test[i].ped) };
  return _S;
}

/* ── scoring many models on a set with one feature map per frame; the arithmetic is SV.score's, term by term; also the cell of the largest logit ── */
function scoreMany(models, set) {
  const out = models.map(() => new Float64Array(set.length)), cells = models.map(() => new Int32Array(set.length)), dim = SV.DIM;
  for (let i = 0; i < set.length; i++) {
    const fm = SV.featureMap(set[i].x), F = fm.F, nc = fm.nu * fm.nv;
    for (let k = 0; k < models.length; k++) {
      const m = models[k], w = m.w, mu = m.mu, sd = m.sd;
      let best = -Infinity, bc = 0;
      for (let c = 0; c < nc; c++) { let z = w[dim]; const o = c * dim; for (let j = 0; j < dim; j++) z += w[j] * (F[o + j] - mu[j]) / sd[j]; if (z > best) { best = z; bc = c; } }
      out[k][i] = best; cells[k][i] = bc;
    }
  }
  return { s: out, c: cells };
}

/* ── grading one model on the real sets ── */
function grade(S, sc, k) {
  const sT = sc.test.s[k], cT = sc.test.c[k], sV = sc.val.s[k], sR = sc.R.s[k];
  const negV = []; for (let i = 0; i < S.val.length; i++) if (!S.val[i].y) negV.push(sV[i]);
  const thr = SV.thrAtFPR(negV, SV.EXAM.fa), ex = SV.exam(S.test, Array.from(sT), { thr: thr });
  const rows = S.ped.map((i) => S.test[i]), sp = S.ped.map((i) => sT[i]);
  const rules = {}; L.RULES.forEach((r) => { const m = L.miss(rows, sp, thr, r); rules[r] = [m.n, r4(m.miss)]; });
  const slice = {}; L.RULES.forEach((r) => { const m = L.miss(S.R, Array.from(sR), thr, r); slice[r] = [m.n, r4(m.miss)]; });
  let free = 0, alarm = 0, van = 0, found = 0, onVis = 0, onSil = 0;
  S.test.forEach((f, i) => {
    if (!f.ped) { free++; if (sT[i] > thr) { alarm++; if (f.vanNear && f.vanNear[cT[i]]) van++; } }
    else if (L.counts(f, 'exam') && sT[i] > thr) { found++; if (L.cellOn(f.cov, cT[i], S.nu, 0.5)) onVis++; if (L.cellOn(f.sil, cT[i], S.nu, 0.5)) onSil++; }
  });
  return { thr: r5(thr), exam: [ex.n, r4(ex.miss), r4(ex.auc)], rules: rules, R: slice, fa: [free, alarm, van], loc: [found, onVis, onSil], sc: sp.map(r2) };
}

/* ── a training job: the three seeds of one label variant ── */
function labelStats(frames, strips) {            // what the variant changes in the training labels, against the program's own (modal) labelling of the same frames
  let posMod = 0, posArm = 0, changed = 0, yChanged = 0, pedFrames = 0;
  frames.forEach((f, i) => {
    const ym = L.present(f.area, f.full, { kvis: 1 }), a = L.cellLabels({ cov: f.cov, y: ym }), b = L.cellLabels(strips[i]);
    if (f.scene.ped) pedFrames++;
    if (strips[i].y !== ym) yChanged++;
    for (let c = 0; c < a.lab.length; c++) { posMod += a.lab[c]; posArm += b.lab[c]; if (a.lab[c] !== b.lab[c]) changed++; }
  });
  return { ped: pedFrames, posModal: posMod, posArm: posArm, changed: changed, yChanged: yChanged };
}
function runVariant(name, seeds) {
  seeds = seeds || SEEDS;
  const v = VARIANTS[name], pipe = pipeOf(v), t0 = Date.now(), models = [], infos = [];
  seeds.forEach((seed) => {
    const frames = SV.makeSet(pipe, N0, SV.SEEDS.train + seed * 100000), strips = frames.map((f) => L.strip(f, v.strip));
    infos.push(labelStats(frames, strips));
    const m = SV.train(strips, { seed: seed });
    models.push({ dim: m.dim, w: Array.from(m.w, r5), mu: Array.from(m.mu, r5), sd: Array.from(m.sd, r5) });
    console.error(name + ' seed ' + seed + ' trained (' + Math.round((Date.now() - t0) / 1000) + ' s)');
  });
  const S = sets(), sc = { test: scoreMany(models, S.test), val: scoreMany(models, S.val), R: scoreMany(models, S.R) };
  console.error(name + ' scored (' + Math.round((Date.now() - t0) / 1000) + ' s)');
  return seeds.map((seed, k) => Object.assign({ id: name, seed: seed, lab: infos[k], model: seed === 1 ? { w: models[k].w, mu: models[k].mu, sd: models[k].sd } : undefined }, grade(S, sc, k)));
}

/* ── the per-pedestrian columns of the real test set, and the series' existing detectors scored on those pedestrians ── */
function runPed() {
  const S = sets(), C = SV.CAM, t0 = Date.now(), cols = { i: [], mode: [], z: [], x: [], a: [], f: [], a8: [], f8: [], a1: [], aT: [], aB: [], iou05: [], iou10: [], jb: [], jb05: [] };
  const sigF = L.SIG_F, sigX = L.SIG_X;
  S.ped.forEach((i) => {
    const fr = SV.sample(SV.REAL, SV.SEEDS.test + i), sc = fr.scene, p = sc.ped.parts[0], cov = fr.cov;
    const c8 = L.cover(sc, { SSh: 8, SSv: 8 }), s8 = L.cover(sc, { only: 'ped', SSh: 8, SSv: 8 }), c1 = L.cover(sc, { SSh: 1, SSv: 1 });
    const bl = L.blur(cov, sigX), h05 = L.cover(sc, { dx: 0.5, dy: 0.5 }), h10 = L.cover(sc, { dx: 1, dy: 1 });
    const iou = (a, b) => { let n = 0, d = 0; for (let q = 0; q < a.length; q++) { n += Math.min(a[q], b[q]); d += Math.max(a[q], b[q]); } return d > 0 ? n / d : 0; };
    const lowest = (m) => { let jb = -1; for (let q = 0; q < m.length; q++) if (m[q] >= 0.5) jb = Math.max(jb, Math.floor(q / C.W)); return jb; };
    cols.i.push(i); cols.mode.push(fr.mode === 'emerge' ? 1 : 0); cols.z.push(r2(p.z)); cols.x.push(r2(p.x));
    cols.a.push(r2(fr.area)); cols.f.push(r2(fr.full)); cols.a8.push(r2(L.areaOf(c8))); cols.f8.push(r2(L.areaOf(s8))); cols.a1.push(L.areaOf(c1));
    cols.aT.push(L.countAbove(cov, 0.5)); cols.aB.push(L.countAbove(bl, 0.5));
    cols.iou05.push(r4(iou(cov, h05))); cols.iou10.push(r4(iou(cov, h10)));
    cols.jb.push(lowest(cov)); cols.jb05.push(lowest(h05));
  });
  console.error('ped columns (' + Math.round((Date.now() - t0) / 1000) + ' s)');
  /* the same columns for Lesson 6's rare slice (3,000 frames of case R: a pedestrian steps out from behind the van closer than 12 m); a lab privilege: a project cannot sample a case on demand */
  const R = { a: [], f: [], a8: [], f8: [], a1: [], aB: [], z: [], x: [] };
  for (let i = 0; i < NR; i++) {
    const fr = L.rareFrame(SEED_R + i), sc = fr.scene, p = sc.ped.parts[0];
    R.a.push(r2(fr.area)); R.f.push(r2(fr.full)); R.a8.push(r2(L.areaOf(L.cover(sc, { SSh: 8, SSv: 8 })))); R.f8.push(r2(L.areaOf(L.cover(sc, { only: 'ped', SSh: 8, SSv: 8 }))));
    R.a1.push(L.areaOf(L.cover(sc, { SSh: 1, SSv: 1 }))); R.aB.push(L.countAbove(L.blur(fr.cov, sigX), 0.5)); R.z.push(r2(p.z)); R.x.push(r2(p.x));
  }
  console.error('rare columns (' + Math.round((Date.now() - t0) / 1000) + ' s)');
  /* the series' existing detectors on the same pedestrians: the sixteen programs of Lesson 2 and the designs of Lesson 6 (the stored models; thresholds as stored) */
  const T = SV.TABLES; require(path.join(DIR, 'l06_data.js'));
  const D6 = SV.L06, models = [], ids = [], thrs = [];
  Object.keys(T.swap).forEach((c) => { const m = T.models['swap@' + c]; ids.push('swap@' + c); models.push({ w: m.w, mu: m.mu, sd: m.sd }); thrs.push(m.thrReal); });
  Object.keys(D6.models).forEach((a) => { const m = D6.models[a]; ids.push('l06@' + a); models.push({ w: m.w, mu: m.mu, sd: m.sd }); thrs.push(m.thr); });
  const set = S.ped.map((i) => S.test[i]), sc = scoreMany(models, set);
  const existing = {}; ids.forEach((id, k) => { existing[id] = { thr: thrs[k], sc: Array.from(sc.s[k], r2) }; });
  console.error('existing models scored (' + Math.round((Date.now() - t0) / 1000) + ' s)');
  return { sigF: r4(sigF), sigX: r4(sigX), cols: cols, R: R, existing: existing };
}

/* ── the scene programs: how often does the label rule matter, and how often does depth differ from range ── */
function runScene() {
  const t0 = Date.now(), out = { share: {}, range: null };
  [['sim0', SV.SIM0.scene], ['street', SV.REAL.scene]].forEach(([name, cfg]) => {
    let frames = 0, ped = 0, pf = 0, pe = 0, fe = 0, hidden = 0, sliv = 0;
    for (let k = 0; k < NS; k++) {
      const sc = SV.drawScene(cfg, SV.stream(S_SCENE + k, 'scene'));
      frames++;
      if (!sc.ped) continue;
      ped++;
      const a = L.areaOf(L.cover(sc)), full = L.areaOf(L.cover(sc, { only: 'ped' })), row = { area: a, full: full };
      const yp = L.counts(row, 'pixel'), yf = L.counts(row, 'frac15'), ye = L.counts(row, 'exam');
      if (yp !== yf) pf++;
      if (yp !== ye) pe++;
      if (yf !== ye) fe++;
      if (a === 0) hidden++;
      if (a < 0.15 * full) sliv++;
    }
    out.share[name] = { frames: frames, ped: ped, pixelVsStreet: pf, pixelVsExam: pe, streetVsExam: fe, hidden: hidden, under15: sliv };
    console.error('scene ' + name + ' (' + Math.round((Date.now() - t0) / 1000) + ' s)');
  });
  /* the street's close step-outs by depth and by range (10^6 scene draws, paired) */
  const cfg = SV.REAL.scene; let em = 0, byDepth = 0, byRange = 0, rmax = 0;
  for (let k = 0; k < ND; k++) {
    const sc = SV.drawScene(cfg, SV.stream(S_SCENE + 5000000 + k, 'scene'));
    if (!sc.ped || sc.mode !== 'emerge') continue;
    em++;
    const p = sc.ped.parts[0], z = p.z, r = L.footRange(p.x, z);
    if (z < 12) byDepth++;
    if (r < 12) byRange++;
    rmax = Math.max(rmax, r / z);
  }
  out.range = { draws: ND, emerge: em, byDepth: byDepth, byRange: byRange, ratioMax: r4(rmax) };
  console.error('range (' + Math.round((Date.now() - t0) / 1000) + ' s)');
  return out;
}

function runJob(name) {
  fs.mkdirSync(JOBDIR, { recursive: true });
  const more = /\+$/.test(name), id = name.replace(/\+$/, '');
  const res = name === 'ped' ? runPed() : name === 'scene' ? runScene() : runVariant(id, more ? [4, 5, 6] : SEEDS);
  fs.writeFileSync(path.join(JOBDIR, (more ? id + '_b' : name) + '.json'), JSON.stringify(res));
  console.error('job ' + name + ' written');
}

/* ── merge the jobs into l07_data.js ── */
function merge() {
  const rd = (n) => JSON.parse(fs.readFileSync(path.join(JOBDIR, n + '.json'), 'utf8'));
  const ped = rd('ped'), scene = rd('scene'), arms = {}, more = {}, models = {};
  Object.keys(VARIANTS).forEach((id) => {
    const rows = rd(id);
    arms[id] = rows.map((r) => ({ seed: r.seed, thr: r.thr, exam: r.exam, rules: r.rules, R: r.R, fa: r.fa, loc: r.loc, lab: r.lab }));
    if (fs.existsSync(path.join(JOBDIR, id + '_b.json'))) more[id] = rd(id + '_b').map((r) => ({ seed: r.seed, thr: r.thr, exam: r.exam, rules: r.rules, R: r.R, fa: r.fa, loc: r.loc, lab: r.lab }));
    const r1 = rows.find((r) => r.seed === 1);
    models[id] = { w: r1.model.w, mu: r1.model.mu, sd: r1.model.sd, thr: r1.thr };
  });
  /* the decisions of the seed-1 detectors on the test set's pedestrians and on the rare slice, from the stored weights and thresholds (exact: nothing is rounded before the comparison) */
  const ids = Object.keys(VARIANTS), pedSet = ped.cols.i.map((i) => ({ x: SV.sample(SV.REAL, SV.SEEDS.test + i, undefined).x })), rareSet = [];
  for (let i = 0; i < NR; i++) rareSet.push({ x: L.rareFrame(SEED_R + i).x });
  const ms = ids.map((id) => models[id]), sc1 = scoreMany(ms, pedSet), sc2 = scoreMany(ms, rareSet), found = {}, foundR = {}, thr = {};
  const bits = (arr, thr_) => { let s = ''; for (let k = 0; k < arr.length; k += 5) { let v = 0; for (let j = 0; j < 5; j++) v = v * 2 + (k + j < arr.length && arr[k + j] > thr_ ? 1 : 0); s += v.toString(32); } return s; };
  ids.forEach((id, k) => { thr[id] = models[id].thr; found[id] = bits(sc1.s[k], thr[id]); foundR[id] = bits(sc2.s[k], thr[id]); });
  const pk = (arr, scale, width, off) => arr.map((v) => { const q = Math.round(v * scale + (off || 0)); if (q < 0 || q >= Math.pow(36, width)) throw new Error('pack overflow ' + v); return q.toString(36).padStart(width, '0'); }).join('');
  const SPEC = { i: [1, 3], mode: [1, 1], z: [100, 3], x: [100, 2, 400], a: [4, 2], f: [4, 2], a8: [64, 3], f8: [64, 3], a1: [1, 2], aB: [1, 2], iou05: [10000, 3], iou10: [10000, 3], jb: [1, 2, 1], jb05: [1, 2, 1] };
  const RSPEC = { a: [4, 2], f: [4, 2], a8: [64, 3], f8: [64, 3], a1: [1, 2], aB: [1, 2], z: [100, 3], x: [100, 2, 400] };
  const pcols = {}, rcols = {}; Object.keys(SPEC).forEach((c) => { pcols[c] = pk(ped.cols[c], SPEC[c][0], SPEC[c][1], SPEC[c][2]); }); Object.keys(RSPEC).forEach((c) => { rcols[c] = pk(ped.R[c], RSPEC[c][0], RSPEC[c][1], RSPEC[c][2]); });
  const pack = { ped: SPEC, R: RSPEC };
  const data = { N: N0, seeds: SEEDS, sets: { test: NT, val: NV, R: NR, seedR: SEED_R, ped: ped.cols.i.length }, ids: ids, thr: thr, sigF: ped.sigF, sigX: ped.sigX, pack: pack, ped: pcols, R: rcols, found: found, foundR: foundR, scene: scene, arms: arms, more: more };
  const body = '/* l07_data.js — generated by tools/chain/verify/engine/build_l07.js; do not edit by hand.  Lesson 7 (what the label means): label variants retrained 3 seeds at N = 1,600, the real test set\'s pedestrians. */\n'
    + '(function (root) { var SV = root.SV; SV.L07 = ' + JSON.stringify(data) + '; if (typeof module !== "undefined" && module.exports) module.exports = SV.L07; })(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this));\n';
  fs.writeFileSync(OUT, body);
  fs.writeFileSync(path.join(JOBDIR, '_existing.json'), JSON.stringify(ped.existing));
  console.error('l07_data.js written (' + body.length + ' bytes)');
}

/* ── the check: one cell from scratch ── */
function check() {
  require(OUT);
  const D = SV.L07, row = runVariant('amodal').find((r) => r.seed === 1), tab = D.arms.amodal.find((r) => r.seed === 1);
  const same = JSON.stringify(row.rules) === JSON.stringify(tab.rules) && row.thr === tab.thr;
  console.error('amodal seed 1: thr ' + row.thr + ' vs ' + tab.thr + ', exam rule ' + JSON.stringify(row.rules.exam) + ' vs ' + JSON.stringify(tab.rules.exam) + (same ? '  OK' : '  MISMATCH'));
  process.exit(same ? 0 : 1);
}

/* ── runner ── */
function spawnJob(name) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [__filename, '--job', name], { stdio: ['ignore', 'inherit', 'inherit'] });
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error('job failed: ' + name))));
  });
}
async function build() {
  const jobs = ['amodal', 'shift05', 'rel50', 'shift10', 'fine', 'ray', 'soft', 'modal', 'rel15', 'ped', 'scene', 'modal+', 'soft+', 'ray+', 'fine+', 'amodal+', 'shift05+', 'rel50+', 'rel15+', 'shift10+'], k = +arg('--jobs', 2); let next = 0;
  await Promise.all(Array.from({ length: k }, async () => { for (;;) { const i = next++; if (i >= jobs.length) return; await spawnJob(jobs[i]); } }));
  merge();
}
if (has('--job')) runJob(arg('--job')); else if (has('--merge')) merge(); else if (has('--check')) check(); else build().catch((e) => { console.error(e); process.exit(1); });
