#!/usr/bin/env node
'use strict';
/* Oracle for synthetic_vision lesson 07 (what the label means).
 *
 * Re-derives every number the lesson quotes with code that does not share a code path with the page, the engine (l07_labels.js) or the builder (build_l07.js):
 *   - the real test set's pedestrians, rebuilt from the series' own API; every packed column of l07_data.js is decoded here and checked against those frames; the columns that need a renderer
 *     (8 x 8 rays, one ray, the filtered mask, the masks displaced by half and one pixel, the foot rows) are recomputed with the STOCK renderer SV.render on every fourth pedestrian
 *     (a displaced mask by rendering the same camera at twice the resolution, with SV.CAM replaced for the call);
 *   - the decisions of the detectors: the two series detectors rescored here (SV.score and an own scorer), the three label variants that matter most (amodal, half pixel, default filter) RETRAINED FROM
 *     SCRATCH with this file's own label construction (stock renders only) and graded with this file's own exam; the stored seed-1 decisions must equal them;
 *   - the rule table, the 3 x 3 matrix (training rule x scoring rule), the retraining table (six seeds, paired by seed), the rank claims (sixteen programs, eleven designs of Lesson 6);
 *   - the scene statistics (how often the label rule matters, how often depth and range disagree) on a subset of the builder's draws with an own label rule and own distance formulas;
 *   - the geometry (range factor), the two conformance tests (a sliver of known area at several ray counts; the ground-plane law on a depth pass and on a range pass), the pixel filter's sigma from its leak;
 *   - the widget, driven through the states the prose names.
 * Where it reads the street's own parameters (SV.REAL.sensor etc.) it says so: there is none in this oracle except the scene law used by the draws of the street, a LAB PRIVILEGE the lesson also uses.
 * Last stdout line: {"facts": {...}}. */
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '../../../all_lessons');
const dir = fs.existsSync(path.join(root, 'synthetic_vision_new')) ? 'synthetic_vision_new' : 'synthetic_vision';
const SV = require(path.join(root, dir, 'street.js'));
require(path.join(root, dir, 'tables.js'));
require(path.join(root, dir, 'l06_data.js'));
const L = require(path.join(root, dir, 'l07_labels.js'));            // the engine under test: used only where the text says so
require(path.join(root, dir, 'l07_data.js'));
const T = SV.TABLES, D = SV.L07, D6 = SV.L06;
const { loadPage } = require('../dom_probe.js');
const T0 = Date.now();

let bad = 0;
const fail = (m) => { bad++; console.error('FAIL ' + m); };
const check = (c, m) => { if (!c) fail(m); };
const F = {};
const put = (k, v, d) => { F[k] = +(+v).toFixed(d === undefined ? 6 : d); };
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const sdev = (a) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };
const pc = (x) => 100 * x;
const sum = (a) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]; return s; };
const log = (m) => console.error('[' + ((Date.now() - T0) / 1000).toFixed(0) + ' s] ' + m);

/* ───────── the rules, written out here (not taken from the engine): a = visible px², f = silhouette px² ───────── */
const RULES = ['pixel', 'k6', 'frac15', 'exam', 'half', 'reason', 'amodal'];
const rule = {
  pixel: (a, f) => a >= 1, k6: (a, f) => a >= 6, frac15: (a, f) => a >= 1 && a >= 0.15 * f, exam: (a, f) => a >= 6 && a >= 0.15 * f,
  half: (a, f) => a > 0 && 2 * a >= f, reason: (a, f) => a > 0 && a >= 0.65 * f, amodal: (a, f) => f >= 6
};

/* ───────── 1 · the test set and the packed columns ───────── */
const test = SV.real.test(3000), val = SV.real.val(1500);
const pedI = []; test.forEach((s, i) => { if (s.scene.ped) pedI.push(i); });
const NP = pedI.length;
check(NP === D.sets.ped && NP === 1517, 'the test set holds ' + NP + ' pedestrian frames');
put('n_test', test.length, 0); put('n_ped', NP, 0);
function unpack36(str, w, scale, off) { const out = []; for (let i = 0; i < str.length / w; i++) out.push((parseInt(str.slice(i * w, (i + 1) * w), 36) - (off || 0)) / scale); return out; }
const PC = {}, RC = {};
Object.keys(D.ped).forEach((c) => { const sp = D.pack.ped[c]; PC[c] = unpack36(D.ped[c], sp[1], sp[0], sp[2]); check(PC[c].length === NP, 'column ' + c + ' has ' + PC[c].length + ' rows'); });
Object.keys(D.R).forEach((c) => { const sp = D.pack.R[c]; RC[c] = unpack36(D.R[c], sp[1], sp[0], sp[2]); check(RC[c].length === D.sets.R, 'rare column ' + c + ' has ' + RC[c].length + ' rows'); });
{ let e = 0;
  pedI.forEach((i, k) => {
    const s = test[i], p = s.scene.ped.parts[0];
    if (PC.i[k] !== i || PC.mode[k] !== (s.mode === 'emerge' ? 1 : 0) || Math.abs(PC.z[k] - p.z) > 0.0051 || Math.abs(PC.x[k] - p.x) > 0.0051 || Math.abs(PC.a[k] - s.area) > 1e-9 || Math.abs(PC.f[k] - s.full) > 1e-9) e++;
  });
  check(e === 0, 'the packed columns i, mode, z, x, a, f equal the frames of the test set (' + e + ' rows differ)'); }

/* the columns that need a renderer, recomputed with the stock renderer on every fourth pedestrian */
function ownBlur(cov, sigma) {                                            // direct 2D convolution (the engine's is separable), edges clamped
  const W = SV.CAM.W, H = SV.CAM.H, kh = Math.ceil(3 * sigma), k = []; let z = 0;
  for (let u = -kh; u <= kh; u++) { k.push(Math.exp(-u * u / (2 * sigma * sigma))); z += k[k.length - 1]; }
  const out = new Float64Array(W * H);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) { let t = 0; for (let b = -kh; b <= kh; b++) for (let a = -kh; a <= kh; a++) t += k[a + kh] * k[b + kh] * cov[Math.min(H - 1, Math.max(0, j + b)) * W + Math.min(W - 1, Math.max(0, i + a))]; out[j * W + i] = t / (z * z); }
  return out;
}
function fineCov(scene, look) {                                           // the camera at twice the resolution, one ray per fine pixel (SV.CAM replaced for the call)
  const old = SV.CAM; SV.CAM = { W: 2 * old.W, H: 2 * old.H, f: 2 * old.f, V0: 2 * old.V0, hc: old.hc };
  try { return SV.render(scene, look, { SSh: 1, SSv: 1, maps: false }).cov; } finally { SV.CAM = old; }
}
function shifted(fine, d) {                                               // pixel (i, j) averages the rays at i + d + 0.25, i + d + 0.75 (and the same in v): fine pixels 2i + 2d and 2i + 2d + 1
  const W = SV.CAM.W, H = SV.CAM.H, out = new Float64Array(W * H);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) { let t = 0; for (let b = 0; b < 2; b++) for (let a = 0; a < 2; a++) { const u = 2 * i + 2 * d + a, v = 2 * j + 2 * d + b; if (u < 2 * W && v < 2 * H) t += fine[v * 2 * W + u]; } out[j * W + i] = t / 4; }
  return out;
}
const softIoU = (a, b) => { let n = 0, m = 0; for (let q = 0; q < a.length; q++) { n += Math.min(a[q], b[q]); m += Math.max(a[q], b[q]); } return m > 0 ? n / m : 0; };
const lowestRow = (m) => { let jb = -1; for (let q = 0; q < m.length; q++) if (m[q] >= 0.5) jb = Math.max(jb, Math.floor(q / SV.CAM.W)); return jb; };
{
  let e = { a8: 0, f8: 0, a1: 0, aB: 0, iou05: 0, iou10: 0, jb: 0, jb05: 0 }, n = 0;
  const sigF = (() => { /* sigma of a Gaussian whose centre-read step leaks 12%: Phi(-0.5/sigma) = 0.12, by bisection on an own erf (Simpson integration) */
    const phi = (x) => { const m = 2000, h = Math.abs(x) / m; let s = 0; for (let i = 0; i <= m; i++) { const t = i * h, w = i === 0 || i === m ? 1 : i % 2 ? 4 : 2; s += w * Math.exp(-t * t / 2); } const half = s * h / 3 / Math.sqrt(2 * Math.PI); return x < 0 ? 0.5 - half : 0.5 + half; };
    let lo = 0.05, hi = 2; for (let k = 0; k < 50; k++) { const mid = (lo + hi) / 2; if (phi(-0.5 / mid) < 0.12) lo = mid; else hi = mid; } return (lo + hi) / 2; })();
  const sigX = Math.sqrt(sigF * sigF - 1 / 12);
  put('sigF', sigF, 2); put('sigBox', 1 / Math.sqrt(12), 2); put('sigX', sigX, 2);
  check(Math.abs(sigF - D.sigF) < 5e-4 && Math.abs(sigX - D.sigX) < 5e-4, 'the data\'s filter sigmas equal the own bisection: ' + sigF.toFixed(4) + ', ' + sigX.toFixed(4));
  check(Math.abs(sigF - L.SIG_F) < 1e-3, 'the engine\'s sigma equals the own one');
  for (let k = 0; k < NP; k += 4) {
    const s = test[pedI[k]], sc = s.scene, lk = s.look; n++;
    const c8 = SV.render(sc, lk, { SSh: 8, SSv: 8, maps: false }).cov, s8 = SV.render(sc, lk, { only: 'ped', SSh: 8, SSv: 8, maps: false }).cov, c1 = SV.render(sc, lk, { SSh: 1, SSv: 1, maps: false }).cov;
    if (Math.abs(sum(c8) - PC.a8[k]) > 1e-9) e.a8++;
    if (Math.abs(sum(s8) - PC.f8[k]) > 1e-9) e.f8++;
    if (sum(c1) !== PC.a1[k]) e.a1++;
    const bl = ownBlur(s.cov, sigX); let cnt = 0; for (let q = 0; q < bl.length; q++) if (bl[q] >= 0.5) cnt++;
    if (cnt !== PC.aB[k]) e.aB++;
    const fine = fineCov(sc, lk), h05 = shifted(fine, 0.5), h10 = shifted(fine, 1);
    if (Math.abs(softIoU(s.cov, h05) - PC.iou05[k]) > 2e-4) e.iou05++;
    if (Math.abs(softIoU(s.cov, h10) - PC.iou10[k]) > 2e-4) e.iou10++;
    if (lowestRow(s.cov) !== PC.jb[k]) e.jb++;
    if (lowestRow(h05) !== PC.jb05[k]) e.jb05++;
  }
  Object.keys(e).forEach((c) => check(e[c] === 0, 'column ' + c + ': ' + e[c] + ' of ' + n + ' sampled pedestrians differ from the own recomputation with the stock renderer'));
  log('columns recomputed on ' + n + ' pedestrians');
}
/* the rare slice's columns: a sample of 150 frames of Lesson 6's own sampler */
{
  const L6 = require(path.join(root, dir, 'l06_rare.js')); let e = 0, n = 0;
  for (let k = 0; k < D.sets.R; k += 20) {
    const f = L6.sample(SV.REAL, D.sets.seedR + k, 'R'), p = f.scene.ped.parts[0]; n++;
    const a8 = sum(SV.render(f.scene, f.look, { SSh: 8, SSv: 8, maps: false }).cov);
    if (Math.abs(f.area - RC.a[k]) > 1e-9 || Math.abs(f.full - RC.f[k]) > 1e-9 || Math.abs(a8 - RC.a8[k]) > 1e-9 || Math.abs(p.z - RC.z[k]) > 0.0051 || Math.abs(p.x - RC.x[k]) > 0.0051 || !(p.z < 12) || f.scene.mode !== 'emerge') e++;
  }
  check(e === 0, 'rare-slice columns equal Lesson 6\'s sampler on ' + n + ' frames (' + e + ' differ)');
}

/* ───────── 2 · the detectors: the two series detectors rescored here; the label variants retrained here ───────── */
const DIM = SV.DIM;
function scoreMany(models, xs) {                                          // an own scorer: one feature map per frame, every model over the cells (SV.score checks it below)
  const out = models.map(() => new Float64Array(xs.length));
  for (let i = 0; i < xs.length; i++) {
    const fm = SV.featureMap(xs[i]), nc = fm.nu * fm.nv;
    models.forEach((m, k) => { let best = -Infinity; for (let c = 0; c < nc; c++) { let z = m.w[DIM]; for (let j = 0; j < DIM; j++) z += m.w[j] * (fm.F[c * DIM + j] - m.mu[j]) / m.sd[j]; if (z > best) best = z; } out[k][i] = best; });
  }
  return out;
}
const pedX = pedI.map((i) => test[i].x);
const SWAP = Object.keys(T.swap), L6A = Object.keys(D6.models);
const modelOf = (id) => id.startsWith('swap@') ? { w: T.models[id].w, mu: T.models[id].mu, sd: T.models[id].sd, thr: T.models[id].thrReal } : { w: D6.models[id.slice(4)].w, mu: D6.models[id.slice(4)].mu, sd: D6.models[id.slice(4)].sd, thr: D6.models[id.slice(4)].thr };
const allIds = SWAP.map((c) => 'swap@' + c).concat(L6A.map((a) => 'l06@' + a)), allM = allIds.map(modelOf);
const SC = scoreMany(allM, pedX); log('27 detectors scored on the pedestrians');
{ const m = allM[allIds.indexOf('swap@bbba')], k = 7; check(Math.abs(SV.score({ dim: DIM, w: m.w, mu: m.mu, sd: m.sd }, pedX[k]).s - SC[allIds.indexOf('swap@bbba')][k]) < 1e-9, 'the own scorer equals SV.score'); }
const decisions = (id) => Array.from(SC[allIds.indexOf(id)], (s) => (s > modelOf(id).thr ? 1 : 0));
const bitsOf = (str, n) => { const o = []; for (let i = 0; i < n; i++) o.push((parseInt(str.charAt(Math.floor(i / 5)), 32) >> (4 - i % 5)) & 1); return o; };
const eqArr = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const dModal = decisions('swap@bbba'), dRel15 = decisions('swap@bbbb');
check(eqArr(dModal, bitsOf(D.found.modal, NP)), 'stored decisions of the program\'s-label detector (seed 1) equal the rescored ones');
check(eqArr(dRel15, bitsOf(D.found.rel15, NP)), 'stored decisions of the street\'s-label detector (seed 1) equal the rescored ones');
check(Math.abs(D.thr.modal - T.models['swap@bbba'].thrReal) < 1e-9 && Math.abs(D.thr.rel15 - T.models['swap@bbbb'].thrReal) < 1e-9, 'stored thresholds equal the tables\'');
/* the exam, by SV.exam (the series' own function) and by the own rule */
{
  const sT = test.map((s, i) => 0); pedI.forEach((i, k) => { sT[i] = SC[allIds.indexOf('swap@bbba')][k]; });
  const ex = SV.exam(test.filter((s, i) => true), sT, { thr: T.models['swap@bbba'].thrReal });
  // the exam needs scores for the frames without a pedestrian too only for the threshold, which is given: pass thr, so only pedestrians matter
  let n = 0, h = 0; pedI.forEach((i, k) => { const s = test[i]; if (s.y && s.area >= 6) { n++; if (dModal[k]) h++; } });
  check(n === ex.n && Math.abs((1 - h / n) - ex.miss) < 1e-12, 'the exam of the series equals the own count: n ' + n + ' vs ' + ex.n);
  check(Math.abs(1 - h / n - T.swap.bbba.realMiss[0]) < 1e-4, 'seed-1 exam miss equals the table cell of bbba');
  put('w_exam_seed1', pc(1 - h / n), 1);
}
const missOn = (dec, r, sel) => { let n = 0, m = 0; for (let k = 0; k < NP; k++) { if (sel && !sel(k)) continue; if (rule[r](PC.a[k], PC.f[k])) { n++; if (!dec[k]) m++; } } return { n: n, miss: n ? m / n : null }; };

/* the label variants retrained from scratch here: an own construction of each label, stock renders only */
const PIPE = SV.hybrid(SV.SIM0, SV.REAL, { scene: 'b', look: 'b', sensor: 'b', label: 'a' });
const r5 = (x) => +Number(x).toPrecision(5);
function ownArm(kind, seed) {
  const frames = SV.makeSet(PIPE, 1600, SV.SEEDS.train + seed * 100000), sigX = D.sigX;
  const strips = frames.map((f) => {
    if (!f.scene.ped) return f;
    let cov;
    if (kind === 'amodal') cov = SV.render(f.scene, f.look, { only: 'ped', maps: false }).cov;
    else if (kind === 'shift05') cov = shifted(fineCov(f.scene, f.look), 0.5);
    else if (kind === 'soft') cov = ownBlur(f.cov, sigX);
    return { x: f.x, cov: Float32Array.from(cov), y: sum(cov) >= 1 ? 1 : 0 };
  });
  const m0 = SV.train(strips, { seed: seed }), m = { w: Array.from(m0.w, r5), mu: Array.from(m0.mu, r5), sd: Array.from(m0.sd, r5) };
  const sV = scoreMany([m], val.map((s) => s.x))[0], neg = []; val.forEach((s, i) => { if (!s.y) neg.push(sV[i]); });
  const thr = SV.thrAtFPR(neg, 0.1), sP = scoreMany([m], pedX)[0], dec = Array.from(sP, (s) => (s > thr ? 1 : 0));
  return { thr: thr, dec: dec };
}
{ /* the displaced mask: the engine's construction equals the own one (the camera rendered at twice the resolution, rays gathered by hand) on every pedestrian frame of the first 300 training frames of seed 1 */
  const fr = SV.makeSet(PIPE, 300, SV.SEEDS.train + 100000); let nb = 0, nn = 0;
  fr.forEach((f) => { if (!f.scene.ped) return; nn++; const mine = shifted(fineCov(f.scene, f.look), 0.5), eng = L.strip(f, L.ARMS.shift05).cov; for (let q = 0; q < mine.length; q++) if (Math.abs(mine[q] - eng[q]) > 1e-6) { nb++; break; } });
  check(nn > 100 && nb === 0, 'the half-pixel mask of the engine equals the own construction on ' + nn + ' frames (' + nb + ' differ)'); }
for (const kind of ['amodal', 'soft']) {
  const r = ownArm(kind, 1), row = D.arms[kind].find((x) => x.seed === 1);
  check(eqArr(r.dec, bitsOf(D.found[kind], NP)), kind + ': the stored decisions (seed 1) equal those of a detector retrained from scratch with the own label construction');
  check(Math.abs(r5(r.thr) - row.thr) < 1e-9, kind + ': threshold ' + r5(r.thr) + ' vs stored ' + row.thr);
  RULES.forEach((q) => { const m = missOn(r.dec, q); check(m.n === row.rules[q][0] && Math.abs(m.miss - row.rules[q][1]) < 6e-5, kind + ' rule ' + q + ': own ' + m.n + '/' + m.miss.toFixed(4) + ' vs stored ' + row.rules[q]); });
  log('retrained ' + kind + ' from scratch: decisions agree');
}

/* ───────── 3 · the rule table, the matrix, the retraining table (stored arms; anchored above) ───────── */
const ARMS = ['modal', 'rel15', 'rel50', 'amodal', 'shift05', 'shift10', 'fine', 'ray', 'soft'];
const m3 = (id, f) => mean(D.arms[id].map(f)), m6 = (id, f) => mean(D.arms[id].concat(D.more[id]).map(f));
check(D.arms.modal.length === 3 && D.more.modal.length === 3 && D.arms.modal.every((r, i) => r.seed === i + 1) && D.more.modal.every((r, i) => r.seed === i + 4), 'three series seeds and three more');
/* anchors against the series' tables and Lesson 6 */
D.arms.modal.forEach((r, i) => check(Math.abs(r.rules.exam[1] - T.swap.bbba.realMiss[i]) < 6e-5 && Math.abs(r.thr - T.swap.bbba.thrReal[i]) < 1e-9, 'modal seed ' + (i + 1) + ' reproduces the table cell bbba'));
D.arms.rel15.forEach((r, i) => check(Math.abs(r.rules.exam[1] - T.swap.bbbb.realMiss[i]) < 6e-5 && Math.abs(r.thr - T.swap.bbbb.thrReal[i]) < 1e-9, 'rel15 seed ' + (i + 1) + ' reproduces the table cell bbbb'));
['pixel', 'exam', 'half'].forEach((r) => D.arms.modal.forEach((row, i) => check(Math.abs(row.R[r][1] - D6.arms.nat.R[r][i]) < 6e-5, 'rare slice, rule ' + r + ', seed ' + (i + 1) + ' equals Lesson 6\'s table')));
put('ex3_modal', pc(m3('modal', (r) => r.rules.exam[1])), 1); put('tab_bbba', pc(mean(T.swap.bbba.realMiss)), 1); put('tab_bbbb', pc(mean(T.swap.bbbb.realMiss)), 1);
put('lab_gap', pc(mean(T.swap.bbbb.realMiss) - mean(T.swap.bbba.realMiss)), 1);
/* Table 1: the seven rules on one detector (three-seed means) */
RULES.forEach((r) => {
  put('n_' + r, D.arms.modal[0].rules[r][0], 0); put('ex_' + r, pc(m3('modal', (x) => x.rules[r][1])), 1);
  put('nR_' + r, D.arms.modal[0].R[r][0], 0); put('Rm_' + r, pc(m3('modal', (x) => x.R[r][1])), 1);
  check(D.arms.modal.every((x) => x.rules[r][0] === D.arms.modal[0].rules[r][0]), 'n counted does not depend on the detector');
  const own = missOn(dModal, r); check(own.n === D.arms.modal[0].rules[r][0] && Math.abs(own.miss - D.arms.modal[0].rules[r][1]) < 6e-5, 'rule ' + r + ' on the whole test set: own count and miss equal the stored seed-1 row');
});
put('ex_spread', Math.max(...RULES.map((r) => F['ex_' + r])) - Math.min(...RULES.map((r) => F['ex_' + r])), 1);
put('Rm_spread7', Math.max(...RULES.map((r) => F['Rm_' + r])) - Math.min(...RULES.map((r) => F['Rm_' + r])), 1);
put('Rm_spread3', F.Rm_pixel - F.Rm_half, 1); put('ex_spread3', F.ex_pixel - F.ex_half, 1);
put('nR_total', D.sets.R, 0); put('exam_share', 100 * F.n_exam / F.n_ped, 0); put('n_exam_pct_amodal', 100 * (F.n_amodal - F.n_exam) / F.n_exam, 0);
/* the matrix: training rule (0, 15%, 50%) by scoring rule (any pixel, the exam, half) */
const MAT = [['modal', 'rel15', 'rel50'], ['pixel', 'exam', 'half']];
MAT[0].forEach((a) => MAT[1].forEach((r) => { put('mx_' + a + '_' + r, pc(m3(a, (x) => x.rules[r][1])), 1); put('mxR_' + a + '_' + r, pc(m3(a, (x) => x.R[r][1])), 1); }));
{
  const col = (pre, a) => F[pre + a + '_pixel'] - F[pre + a + '_half'];
  const row = (pre, r) => Math.max(...MAT[0].map((a) => F[pre + a + '_' + r])) - Math.min(...MAT[0].map((a) => F[pre + a + '_' + r]));
  put('col_whole', col('mx_', 'modal'), 1); put('col_R', col('mxR_', 'modal'), 1);
  put('row_whole', Math.max(...MAT[1].map((r) => row('mx_', r))), 1); put('row_R', Math.max(...MAT[1].map((r) => row('mxR_', r))), 1);
  put('ratio_R', F.col_R / F.row_R, 0); put('ratio_whole', F.col_whole / F.row_whole, 0);
  put('half_trained_gap', F.mxR_rel50_half - F.mxR_modal_half, 1);
  check(F.col_R > 5 * F.row_R && F.col_whole > 4 * F.row_whole, 'the scoring rule moves the number more than five (rare slice) and four (whole exam) times as far as the training rule');
  check(F.mxR_rel50_half > F.mxR_modal_half && F.mx_rel50_half > F.mx_modal_half, 'training under the rule one is scored by does not help: the 50%-taught detector is worse under the half rule');
}

/* the retraining table: the same 1,600 frames and seeds, only the label differs; differences paired by seed over six seeds */
ARMS.forEach((a) => {
  put('ex3_' + a, pc(m3(a, (x) => x.rules.exam[1])), 1);
  if (a === 'modal') return;
  const d = D.arms[a].concat(D.more[a]).map((r, i) => pc(r.rules.exam[1] - D.arms.modal.concat(D.more.modal)[i].rules.exam[1]));
  const dR = D.arms[a].concat(D.more[a]).map((r, i) => pc(r.R.exam[1] - D.arms.modal.concat(D.more.modal)[i].R.exam[1]));
  put('d6_' + a, mean(d), 1); put('se6_' + a, sdev(d) / Math.sqrt(d.length), 1); put('dR6_' + a, mean(dR), 1);
  put('cells_' + a, D.arms[a][0].lab.changed, 0); put('cellpct_' + a, 100 * D.arms[a][0].lab.changed / D.arms[a][0].lab.posModal, 1); put('pos_' + a, D.arms[a][0].lab.posArm, 0);
  F['sign_' + a] = d.every((v) => v > 0) ? 1 : d.every((v) => v < 0) ? -1 : 0;
});
put('pos_modal', D.arms.modal[0].lab.posModal, 0); put('ped_train', D.arms.modal[0].lab.ped, 0);
check(F.sign_amodal === 1 && F.sign_shift05 === 1 && F.sign_shift10 === 1 && F.sign_soft === -1, 'amodal, half-pixel and one-pixel labels cost points in every one of six seeds, the default filter\'s labels gain points in every one');
['rel15', 'rel50', 'fine', 'ray'].forEach((a) => check(Math.abs(F['d6_' + a]) < 2.5 * Math.max(F['se6_' + a], 0.05) + 0.3, a + ': the retraining difference ' + F['d6_' + a] + ' is within the seed wobble (se ' + F['se6_' + a] + ')'));
check(F.d6_shift10 > F.d6_shift05 && F.d6_shift05 > F.d6_amodal, 'the cost grows from amodal to half a pixel to one pixel');
check(F.dR6_amodal < -1.5 && F.d6_amodal > 0.8, 'the amodal-taught detector is better on the rare slice and worse on the exam: the order of two detectors depends on whom the miss is averaged over');
put('van6_modal', mean(D.arms.modal.concat(D.more.modal).map((r) => 100 * r.fa[2] / r.fa[1])), 0); put('van6_amodal', mean(D.arms.amodal.concat(D.more.amodal).map((r) => 100 * r.fa[2] / r.fa[1])), 0);
check(F.van6_amodal > F.van6_modal + 4, 'the amodal-taught detector\'s false alarms sit near the van more often');
put('loc_modal', mean(D.arms.modal.concat(D.more.modal).map((r) => 100 * r.loc[1] / r.loc[0])), 0); put('loc_amodal', mean(D.arms.amodal.concat(D.more.amodal).map((r) => 100 * r.loc[1] / r.loc[0])), 0);
put('ex3_soft_gain', F.ex3_modal - F.ex3_soft, 1);
log('tables done');
put('cam_f', SV.CAM.f, 1); put('cam_hc', SV.CAM.hc, 1); put('cam_V0', SV.CAM.V0, 0);
{ /* what the default filter's mask removes: the first 600 frames of the seed-1 training set, with the own blur and the own cell rule */
  const fr = SV.makeSet(PIPE, 600, SV.SEEDS.train + 100000), W = SV.CAM.W, H = SV.CAM.H, sx = D.sigX;
  const cells = (cov, y) => { const out = []; for (let jv = 0; jv < 12; jv++) for (let iu = 0; iu < 48; iu++) { const u = Math.min(W - 1, 2 * iu + 1), v = Math.min(H - 1, 2 * jv + 1); out.push({ u: u, v: v, on: (Math.max(cov[v * W + u], cov[Math.max(0, v - 1) * W + u]) >= 0.5 && y) ? 1 : 0 }); } return out; };
  let pos = 0, rem = 0, add = 0, edge = 0, head = 0, headAll = 0, feet = 0, feetAll = 0;
  fr.forEach((f) => {
    if (!f.scene.ped) return;
    const sil = SV.render(f.scene, f.look, { only: 'ped', maps: false }).cov; let v0 = 99, v1 = -1, u0 = 99, u1 = -1;
    for (let q = 0; q < sil.length; q++) if (sil[q] >= 0.5) { const v = Math.floor(q / W), u = q % W; v0 = Math.min(v0, v); v1 = Math.max(v1, v); u0 = Math.min(u0, u); u1 = Math.max(u1, u); }
    if (v1 < 0) return;
    const a = cells(f.cov, f.area >= 1 ? 1 : 0), cs = Float32Array.from(ownBlur(f.cov, sx)), b = cells(cs, sum(cs) >= 1 ? 1 : 0);      // the labels are stored as float32, as the training code reads them
    a.forEach((c, k) => {
      if (!c.on && !b[k].on) return;
      const band = Math.min(3, Math.floor((c.v - v0) / Math.max(1, v1 - v0 + 1) * 4));
      if (c.on) { pos++; if (band === 0) headAll++; if (band === 3) feetAll++; }
      if (c.on && !b[k].on) { rem++; if (band === 0) head++; if (band === 3) feet++; if (c.u <= u0 + 0.5 || c.u >= u1 - 0.5) edge++; }
      if (!c.on && b[k].on) add++;
    });
  });
  put('soft_removed_pct', 100 * rem / pos, 0); put('soft_head_pct', 100 * head / headAll, 0); put('soft_feet_pct', 100 * feet / feetAll, 0); put('soft_edge_pct', 100 * edge / rem, 0);
  check(add === 0 && F.soft_head_pct > F.soft_removed_pct && F.soft_feet_pct > F.soft_removed_pct && F.soft_edge_pct > 60, 'the default filter\'s mask only removes positive cells, mostly at the head, the feet and the outer columns (' + [F.soft_removed_pct, F.soft_head_pct, F.soft_feet_pct, F.soft_edge_pct, add].join(', ') + ')');
}

/* ───────── 4 · which clause bites where: the rank claims over sixteen programs and eleven designs ───────── */
function ranks(a) { const idx = a.map((v, i) => [v, i]).sort((x, y) => x[0] - y[0]), r = new Array(a.length); let i = 0; while (i < idx.length) { let j = i; while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++; for (let k = i; k <= j; k++) r[idx[k][1]] = (i + j) / 2 + 1; i = j + 1; } return r; }
function pearson(a, b) { const ma = mean(a), mb = mean(b); let n = 0, da = 0, db = 0; for (let i = 0; i < a.length; i++) { n += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2; } return n / Math.sqrt(da * db); }
{
  const missBy = {}; allIds.forEach((id) => { missBy[id] = {}; RULES.forEach((r) => { missBy[id][r] = missOn(decisions(id), r).miss; }); });
  let rhoMin = 1, flips = 0, pairs = 0;
  for (const grp of [allIds.filter((i) => i.startsWith('swap@')), allIds.filter((i) => i.startsWith('l06@'))]) {
    RULES.forEach((r) => { if (r !== 'exam') rhoMin = Math.min(rhoMin, pearson(ranks(grp.map((i) => missBy[i].exam)), ranks(grp.map((i) => missBy[i][r])))); });
    for (let a = 0; a < grp.length; a++) for (let b = a + 1; b < grp.length; b++) RULES.forEach((r1) => RULES.forEach((r2) => {
      if (r1 >= r2) return; pairs++;
      const d1 = missBy[grp[a]][r1] - missBy[grp[b]][r1], d2 = missBy[grp[a]][r2] - missBy[grp[b]][r2];
      if (d1 * d2 < 0 && Math.min(Math.abs(d1), Math.abs(d2)) > 0.006) flips++;
    }));
  }
  put('rho_min', rhoMin, 3); put('rank_flips', flips, 0); put('n_programs', 16, 0); put('n_designs', 11, 0);
  check(rhoMin > 0.99 && flips === 0, 'a rule never reorders detectors: Spearman >= ' + rhoMin.toFixed(4) + ', ' + flips + ' reversals by more than 0.6 points among ' + pairs + ' pair-rule combinations');
  put('swap_exam_lo', pc(Math.min(...allIds.filter((i) => i.startsWith('swap@')).map((i) => missBy[i].exam))), 1); put('swap_exam_hi', pc(Math.max(...allIds.filter((i) => i.startsWith('swap@')).map((i) => missBy[i].exam))), 1);
}

/* ───────── 5 · where the label rule matters: the draws of the program's scene and the street's ───────── */
{
  const NS = 8000, S0 = 17000000; let out = {};
  [['sim0', SV.SIM0], ['street', SV.REAL]].forEach(([name, pipe]) => {
    let ped = 0, ps = 0, pe = 0, se = 0, hidden = 0;
    for (let k = 0; k < NS; k++) {
      const sc = SV.drawScene(pipe.scene, SV.stream(S0 + k, 'scene'));
      if (!sc.ped) continue; ped++;
      const look = SV.drawLook(pipe.look, sc, SV.stream(S0 + k, 'look')), a = sum(SV.render(sc, look, { maps: false }).cov), f = sum(SV.render(sc, look, { only: 'ped', maps: false }).cov);
      if (rule.pixel(a, f) !== rule.frac15(a, f)) ps++;
      if (rule.pixel(a, f) !== rule.exam(a, f)) pe++;
      if (rule.frac15(a, f) !== rule.exam(a, f)) se++;
      if (a === 0) hidden++;
    }
    out[name] = { ped: ped, ps: ps, pe: pe, se: se, hidden: hidden };
  });
  const S = D.scene.share;
  check(out.sim0.ps === 0 && out.sim0.pe === 0 && S.sim0.pixelVsStreet === 0 && S.sim0.pixelVsExam === 0 && S.sim0.streetVsExam === 0, 'the program\'s scene never makes the rules disagree');
  const binom = (k1, n1, k2, n2) => { const p = (k1 + k2) / (n1 + n2); return Math.abs(k1 / n1 - k2 / n2) <= 5 * Math.sqrt(p * (1 - p) * (1 / n1 + 1 / n2)) + 1e-9; };
  check(binom(out.street.ps, out.street.ped, S.street.pixelVsStreet, S.street.ped) && binom(out.street.pe, out.street.ped, S.street.pixelVsExam, S.street.ped) && binom(out.street.se, out.street.ped, S.street.streetVsExam, S.street.ped) && binom(out.street.hidden, out.street.ped, S.street.hidden, S.street.ped), 'the street\'s scene: own rates on 8,000 draws agree with the stored 40,000');
  put('sc_sim_ped', S.sim0.ped, 0); put('sc_sim_ps', S.sim0.pixelVsStreet, 0); put('sc_sim_pe', S.sim0.pixelVsExam, 0);
  put('sc_st_ped', S.street.ped, 0); put('sc_st_ps', S.street.pixelVsStreet, 0); put('sc_st_pe', S.street.pixelVsExam, 0); put('sc_st_se', S.street.streetVsExam, 0);
  put('sc_st_ps_pct', 100 * S.street.pixelVsStreet / S.street.ped, 1); put('sc_st_pe_pct', 100 * S.street.pixelVsExam / S.street.ped, 1); put('sc_st_hidden_pct', 100 * S.street.hidden / S.street.ped, 1);
  put('sc_frames', S.street.frames, 0);
  log('scene shares recomputed on 8,000 draws');
}
/* depth against range: the case R of Lesson 6 by depth and by range, on a fifth of the builder's draws; the exam's pedestrians by distance bin */
{
  const cfg = SV.REAL.scene, ND = 200000, S1 = 17000000 + 5000000; let em = 0, byD = 0, byR = 0, rmax = 0;
  for (let k = 0; k < ND; k++) {
    const sc = SV.drawScene(cfg, SV.stream(S1 + k, 'scene')); if (!sc.ped || sc.mode !== 'emerge') continue; em++;
    const p = sc.ped.parts[0], r = Math.hypot(p.x, p.z, SV.CAM.hc);
    if (p.z < 12) byD++; if (r < 12) byR++; rmax = Math.max(rmax, r / p.z);
  }
  const Rg = D.scene.range;
  check(Math.abs(byR / byD - Rg.byRange / Rg.byDepth) < 0.03 && Math.abs(byD / ND - Rg.byDepth / Rg.draws) < 6 * Math.sqrt(Rg.byDepth / Rg.draws / ND), 'case R by range over case R by depth: own ' + (byR / byD).toFixed(3) + ' on 200,000 draws vs stored ' + (Rg.byRange / Rg.byDepth).toFixed(3));
  const P_R = require(path.join(root, dir, 'l06_rare.js')).P_R;               // Lesson 6's frequency of case R by depth (an exact integral of the scene law, which its own oracle checks)
  put('pR_depth', 100 * P_R, 3); put('pR_range', 100 * P_R * Rg.byRange / Rg.byDepth, 3); put('pR_cut', 100 * (1 - Rg.byRange / Rg.byDepth), 0); put('r_max_stepout', Rg.ratioMax, 2);
  check(Math.abs(Rg.byDepth / Rg.draws - P_R) < 6 * Math.sqrt(P_R / Rg.draws), 'the 10^6 draws reproduce Lesson 6\'s frequency of case R: ' + (Rg.byDepth / Rg.draws) + ' vs ' + P_R);
  put('draws', Rg.draws, 0);
  check(rmax <= Rg.ratioMax + 1e-9 && rmax > 1.03, 'largest range / depth among step-outs ' + rmax.toFixed(4));
}
{
  const bin = (d) => d < 12 ? 0 : d < 16 ? 1 : d < 20 ? 2 : 3;
  let nE = 0, chg = 0, cD = 0, cR = 0, rmax = 0;
  for (let k = 0; k < NP; k++) if (rule.exam(PC.a[k], PC.f[k])) { nE++; const r = Math.hypot(PC.x[k], PC.z[k], SV.CAM.hc); if (bin(r) !== bin(PC.z[k])) chg++; if (PC.z[k] < 12) cD++; if (r < 12) cR++; rmax = Math.max(rmax, r / PC.z[k]); }
  put('bin_chg', chg, 0); put('bin_pct', 100 * chg / nE, 1); put('close_d', cD, 0); put('close_r', cR, 0); put('close_pct', 100 * (1 - cR / cD), 0); put('r_max_exam', rmax, 2);
  // the same on the rare slice: every frame is closer than 12 m by depth; by range some are not
  let rr = 0; for (let k = 0; k < D.sets.R; k++) if (Math.hypot(RC.x[k], RC.z[k], SV.CAM.hc) < 12) rr++;
  put('R_by_range', rr, 0); put('R_by_range_pct', 100 * rr / D.sets.R, 0);
  check(RC.z.every((z) => z < 12.0051), 'every frame of the rare slice is closer than 12 m by depth (columns are rounded to a centimetre)');
}

/* ───────── 6 · the geometry: range factor, and the identity against the stock renderer's range map ───────── */
{
  const C = SV.CAM, tanE = (C.W / 2) / C.f;
  put('rf_edge', Math.sqrt(1 + Math.tan(Math.PI / 6) ** 2), 3); put('fov_half_tan', tanE, 3);
  const rf = (u, v) => Math.sqrt(1 + ((u + 0.5 - C.W / 2) / C.f) ** 2 + ((C.V0 - v - 0.5) / C.f) ** 2);
  put('rf_corner', rf(0, C.H - 1), 3);
  const fr = SV.sample(SV.SIM0, 11); let w = 0, n = 0;
  for (let j = 11; j < C.H; j++) for (let i = 0; i < C.W; i++) { const q = j * C.W + i; if (fr.id[q] !== -1) continue; w = Math.max(w, Math.abs(fr.range[q] / fr.depth[q] - rf(i, j))); n++; }
  check(n > 100 && w < 1e-5, 'range / depth on the ground equals sqrt(1 + tan^2 + rho^2) (worst deviation ' + w + ' over ' + n + ' pixels)');
  check(L.rangeFactor((0.5 - C.W / 2) / C.f, (C.V0 - (C.H - 1) - 0.5) / C.f) - rf(0, C.H - 1) < 1e-12, 'the engine\'s range factor equals the own one');
  // the foot of a pedestrian: engine's footRange equals the Euclidean distance
  check(Math.abs(L.footRange(2.5, 12) - Math.hypot(2.5, 12, 1.4)) < 1e-12, 'footRange');
  put('ck_r', Math.hypot(2.5, 11.9, 1.4), 2); put('ck_r2', Math.hypot(2, 11.5, 1.4), 2);
}

/* ───────── 7 · the half pixel, the resolution and the readers (from the columns) ───────── */
{
  const ex = []; for (let k = 0; k < NP; k++) if (rule.exam(PC.a[k], PC.f[k])) ex.push(k);
  put('iou05', pc(mean(ex.map((k) => PC.iou05[k]))), 0); put('iou05_lt', pc(ex.filter((k) => PC.iou05[k] < 0.5).length / ex.length), 0);
  put('iou10', pc(mean(ex.map((k) => PC.iou10[k]))), 0); put('iou10_lt', pc(ex.filter((k) => PC.iou10[k] < 0.5).length / ex.length), 0);
  const zOf = (jb) => SV.CAM.f * SV.CAM.hc / (jb + 0.75 - SV.CAM.V0);        // Lesson 5's reading of the foot row (the middle of the row's interval)
  put('foot_err', pc(mean(ex.map((k) => Math.abs(zOf(PC.jb05[k]) - zOf(PC.jb[k])) / zOf(PC.jb[k])))), 0); put('foot_chg', pc(ex.filter((k) => PC.jb[k] !== PC.jb05[k]).length / ex.length), 0);
  put('hid2', PC.a.filter((v) => v === 0).length, 0); put('hid8', PC.a8.filter((v) => v === 0).length, 0); put('hid1', PC.a1.filter((v) => v === 0).length, 0);
  let f6 = 0; for (let k = 0; k < NP; k++) if ((PC.a[k] >= 6) !== (PC.a8[k] >= 6)) f6++;
  put('flip6', f6, 0); const near = PC.a.filter((v) => v >= 3 && v < 10).length; put('near6', near, 0); put('flip6_near_pct', 100 * f6 / near, 0);
  // the readers: the exam's rule read with another area; the same detector (seed 1), decisions of the seed-1 detector above
  const READ = { lab: ['a', 'f'], fine: ['a8', 'f8'], ray: ['a1', 'f'], filter: ['aB', 'f'] };
  Object.keys(READ).forEach((nm) => {
    const A = PC[READ[nm][0]], Fc = PC[READ[nm][1]]; let cnt = 0, miss = 0, flips = 0, fin = 0, fout = 0;
    for (let k = 0; k < NP; k++) { const me = A[k] >= 6 && A[k] >= 0.15 * Fc[k], ref = rule.exam(PC.a[k], PC.f[k]); if (me) { cnt++; if (!dModal[k]) miss++; } if (me !== ref) { flips++; if (me) fin++; else fout++; } }
    put('rd_' + nm + '_n', cnt, 0); put('rd_' + nm + '_miss', pc(miss / cnt), 1); put('rd_' + nm + '_flip', flips, 0); put('rd_' + nm + '_flip_pct', 100 * flips / F.n_exam, 1); put('rd_' + nm + '_in', fin, 0); put('rd_' + nm + '_out', fout, 0);
  });
  check(F.rd_lab_flip === 0 && F.rd_lab_n === F.n_exam, 'the lab\'s own reader reproduces the exam');
  // the same readers on the rare slice (the decisions are the stored seed-1 ones)
  const fR = bitsOf(D.foundR.modal, D.sets.R); const RREAD = { lab: ['a', 'f'], fine: ['a8', 'f8'], ray: ['a1', 'f'], filter: ['aB', 'f'] };
  Object.keys(RREAD).forEach((nm) => { const A = RC[RREAD[nm][0]], Fc = RC[RREAD[nm][1]]; let cnt = 0, miss = 0; for (let k = 0; k < D.sets.R; k++) if (A[k] >= 6 && A[k] >= 0.15 * Fc[k]) { cnt++; if (!fR[k]) miss++; } put('rdR_' + nm + '_n', cnt, 0); put('rdR_' + nm + '_miss', pc(miss / cnt), 1); });
  put('w_R_exam_seed1', F.rdR_lab_miss, 1);
  // how much of the rare case is slivers, and the curve the rules cut (seed-1 decisions on the rare slice, the lab's reader)
  let lo = [0, 0], hi = [0, 0], ltR = 0; for (let k = 0; k < D.sets.R; k++) { const fr = RC.f[k] > 0 ? RC.a[k] / RC.f[k] : 0; if (fr < 0.25) { lo[0]++; if (!fR[k]) lo[1]++; } if (fr >= 0.8) { hi[0]++; if (!fR[k]) hi[1]++; } if (!rule.half(RC.a[k], RC.f[k])) ltR++; }
  put('curve_lo', 100 * lo[1] / lo[0], 0); put('curve_hi', 100 * hi[1] / hi[0], 0); put('R_lt_half', 100 * ltR / D.sets.R, 0); put('A_lt_half', 100 * (NP - F.n_half) / NP, 0);
  check(F.curve_lo > 85 && F.curve_hi < 45, 'the miss rate falls as more of him shows (' + F.curve_lo + '% under a quarter, ' + F.curve_hi + '% over four fifths)');
}
{ // Lesson 2's price of the label stage: the Shapley value of the fourth stage over the 24 orders of repair, from the sixteen programs of the tables
  const hit = (c) => 1 - mean(T.swap[c].realMiss), code = (st) => st.map((b) => (b ? 'b' : 'a')).join('');
  const perm = (a) => a.length <= 1 ? [a] : a.flatMap((x, i) => perm(a.slice(0, i).concat(a.slice(i + 1))).map((q) => [x].concat(q)));
  let phi = 0; const os = perm([0, 1, 2, 3]); os.forEach((o) => { const st = [0, 0, 0, 0]; for (const i of o) { const b = hit(code(st)); st[i] = 1; if (i === 3) phi += (hit(code(st)) - b) / os.length; } });
  put('phi_label', 100 * phi, 1); check(Math.abs(F.phi_label) < 0.5, 'Lesson 2 prices the label stage at nothing');
  put('ped_w16', 2 * SV.CAM.f * 0.24 / 16, 1);                       // a pedestrian of radius 0.24 m at 16 m
}
{ // arithmetic of the prose: a walking pedestrian in an exposure, the checkpoint
  put('mot_px', SV.CAM.f * 1.5 * 0.02 / 12, 2); put('leak_pct', 12, 0);   // the 12% leak is an external fact (a measured run of Blender 5.2.2), not computed here
  put('ck_inter', (1.2 - 0.5) * (5 - 0.5), 2); put('ck_union', 12 - (1.2 - 0.5) * (5 - 0.5), 2); put('ck_iou', (1.2 - 0.5) * (5 - 0.5) / (12 - (1.2 - 0.5) * (5 - 0.5)), 2);
}

/* ───────── 8 · the contract's two tests, by the stock renderer ───────── */
{
  const C = SV.CAM, look = { l: [0, 1, 0], amb: 0.5, lum: 1, col: { 0: [0.5, 0.5, 0.5] }, stripe: { 0: 0 }, ph: { 0: 0 }, skyH: [0.5, 0.5, 0.5], skyZ: [0.5, 0.5, 0.5], ground: 0.3, win: 0 };
  const sliver = (u0, v0, wp, hp, z) => { const w = wp * z / C.f, h = hp * z / C.f, xl = (u0 - C.W / 2) * z / C.f, yt = C.hc + (C.V0 - v0) * z / C.f; return { parts: [{ kind: 'box', x: xl + w / 2, z: z + 0.001, hx: w / 2, hz: 0.001, y0: yt - h, y1: yt, cls: 'ped', id: 0, pid: 0 }] }; };
  const worst = (ss, wp, hp) => { let wst = 0, s = 0; for (let k = 0; k < 16; k++) { const a = sum(SV.render(sliver(40 + (k % 4) / 4 + 0.06, 8 + Math.floor(k / 4) / 4 + 0.11, wp, hp, 12), look, { SSh: ss, SSv: ss, maps: false }).cov); s += a - wp * hp; wst = Math.max(wst, Math.abs(a - wp * hp)); } return { worst: wst, bias: s / 16 }; };
  put('sliver_area', 1.2 * 5, 1);
  [1, 2, 8].forEach((ss) => { const r = worst(ss, 1.2, 5), e = L.testCoverage(ss, 1.2, 5); put('cov_worst_' + ss, r.worst, 2); check(Math.abs(r.worst - e.worst) < 1e-9 && Math.abs(r.bias - e.bias) < 1e-9, 'the engine\'s coverage test equals the own one at ' + ss + ' rays'); });
  const fine = worst(64, 1.2, 5); check(Math.abs(fine.worst) < 0.1 && Math.abs(fine.bias) < 0.1, 'the sliver\'s analytic area (width times height in pixels) is what a fine grid counts: ' + fine.worst.toFixed(3));
  put('cov_bias_max', Math.max(...[1, 2, 8].map((ss) => Math.abs(worst(ss, 1.2, 5).bias))), 2);
  put('cov_flip_ratio_2', 100 * F.cov_worst_2 / F.sliver_area, 0); put('cov_flip_ratio_1', 100 * F.cov_worst_1 / F.sliver_area, 0);
  check(F.cov_worst_1 > F.cov_worst_2 && F.cov_worst_2 > F.cov_worst_8 && F.cov_worst_8 < 0.5, 'the error of the counted area falls as the rays multiply');
  const fr = SV.sample(SV.SIM0, 5); let wd = 0, wr = 0;
  for (let j = 9; j < C.H; j++) for (let i = 0; i < C.W; i++) { const q = j * C.W + i; if (fr.id[q] !== -1 || !fr.depth[q]) continue; const law = C.f * C.hc / (j + 0.5 - C.V0); wd = Math.max(wd, Math.abs(fr.depth[q] / law - 1)); wr = Math.max(wr, Math.abs(fr.range[q] / law - 1)); }
  put('dep_depth', wd, 4); put('dep_range', wr, 3);
  const e1 = L.testDepth(fr.depth, fr.id), e2 = L.testDepth(fr.range, fr.id); check(Math.abs(e1.worst - wd) < 1e-12 && Math.abs(e2.worst - wr) < 1e-12, 'the engine\'s depth test equals the own one');
  check(wd < 1e-5 && wr > 0.1, 'a depth pass obeys the ground-plane law, a range pass violates it');
}

/* ───────── 9 · the widget ───────── */
if (!process.env.L07_SKIP_PAGE) {
  const page = loadPage(path.join(root, dir, '07_what_the_label_means.html'), { dpr: 2, console: { log() {}, warn() {}, error() {} } });
  check(page.problems.length === 0, 'the page runs clean: ' + page.problems.slice(0, 2).join(' | '));
  const fR = bitsOf(D.foundR.modal, D.sets.R), found = {}, foundR = {};
  D.ids.forEach((id) => { found[id] = bitsOf(D.found[id], NP); foundR[id] = bitsOf(D.foundR[id], D.sets.R); });
  const pops = { all: { n: NP, c: PC, f: found }, R: { n: D.sets.R, c: RC, f: foundR } };
  const READ = { lab: ['a', 'f'], fine: ['a8', 'f8'], ray: ['a1', 'f'], filter: ['aB', 'f'], amodal: ['f', 'f'] };
  function expect(st) {
    const q = pops[st.pop], rd = READ[st.rd]; let n = 0, m = 0, nc = 0, mc = 0, iu = 0, ni = 0, lo = 1, hi = 0;
    for (let k = 0; k < q.n; k++) if (q.c[rd[0]][k] >= st.k && q.c[rd[0]][k] >= st.r * q.c[rd[1]][k]) { n++; if (!q.f[st.det][k]) m++; const d = st.dist === 'range' ? Math.hypot(q.c.x[k], q.c.z[k], SV.CAM.hc) : q.c.z[k]; if (d < 12) { nc++; if (!q.f[st.det][k]) mc++; } if (q.c.iou05) { iu += q.c.iou05[k]; ni++; } }
    D.ids.forEach((id) => { let n2 = 0, m2 = 0; for (let k = 0; k < q.n; k++) if (q.c[rd[0]][k] >= st.k && q.c[rd[0]][k] >= st.r * q.c[rd[1]][k]) { n2++; if (!q.f[id][k]) m2++; } const v = m2 / n2; lo = Math.min(lo, v); hi = Math.max(hi, v); });
    let ex = 0, exn = 0; for (let k = 0; k < q.n; k++) if (q.c.a[k] >= 6 && q.c.a[k] >= 0.15 * q.c.f[k]) { exn++; if (!q.f[st.det][k]) ex++; }
    return { n: n, miss: m / n, vs: m / n - ex / exn, spread: hi - lo, close: nc, closeMiss: nc ? mc / nc : 0, iou: ni ? iu / ni : null };
  }
  const base = { r: 0.15, k: 6, pop: 'R', rd: 'lab', det: 'modal', dist: 'depth', off: false };
  const apply = (st) => { page.set('w07-cut', st.r); page.check('w07-k6', st.k === 6); page.set('w07-pop', st.pop); page.set('w07-area', st.rd); page.set('w07-det', st.det); page.set('w07-dist', st.dist); page.check('w07-off', st.off); };
  const read = () => ({ n: page.num('w07-n'), miss: page.num('w07-miss'), vs: page.text('w07-vs'), spread: page.num('w07-spread'), close: page.text('w07-close'), iou: page.text('w07-iou') });
  const fmtPct = (x) => (100 * x).toFixed(1) + '%';
  const states = {
    R_exam: base, R_pixel: Object.assign({}, base, { r: 0, k: 1 }), R_half: Object.assign({}, base, { r: 0.5, k: 1 }), R_reason: Object.assign({}, base, { r: 0.65, k: 1 }),
    A_exam: Object.assign({}, base, { pop: 'all' }), A_pixel: Object.assign({}, base, { pop: 'all', r: 0, k: 1 }), A_half: Object.assign({}, base, { pop: 'all', r: 0.5, k: 1 }),
    R_amodal_det: Object.assign({}, base, { det: 'amodal' }), R_shift10: Object.assign({}, base, { det: 'shift10' }), R_soft: Object.assign({}, base, { det: 'soft' }),
    R_ray: Object.assign({}, base, { rd: 'ray' }), R_filter: Object.assign({}, base, { rd: 'filter' }), R_fine: Object.assign({}, base, { rd: 'fine' }), R_amodal_read: Object.assign({}, base, { rd: 'amodal' }),
    A_ray: Object.assign({}, base, { pop: 'all', rd: 'ray' }), A_filter: Object.assign({}, base, { pop: 'all', rd: 'filter' }), A_fine: Object.assign({}, base, { pop: 'all', rd: 'fine' }), A_amodal_read: Object.assign({}, base, { pop: 'all', rd: 'amodal', k: 6, r: 0 }),
    R_range: Object.assign({}, base, { dist: 'range' }), A_range: Object.assign({}, base, { pop: 'all', dist: 'range' }), A_off: Object.assign({}, base, { pop: 'all', off: true })
  };
  Object.keys(states).forEach((nm) => {
    const st = states[nm], e = expect(st); apply(st); const g = read();
    check(g.n === e.n && Math.abs(g.miss - 100 * e.miss) < 0.051 && g.vs === ((e.vs >= 0 ? '+' : '−') + (100 * Math.abs(e.vs)).toFixed(1) + ' pts') && Math.abs(g.spread - 100 * e.spread) < 0.051 && g.close === e.close + ' · ' + fmtPct(e.closeMiss) && (e.iou === null ? g.iou === '—' : g.iou === (100 * e.iou).toFixed(0) + '%'),
      'widget state ' + nm + ': page shows n=' + g.n + ' miss=' + g.miss + ' vs=' + g.vs + ' spread=' + g.spread + ' close=' + g.close + ' iou=' + g.iou + '; expected n=' + e.n + ' miss=' + (100 * e.miss).toFixed(1) + ' close=' + e.close);
    put('w_' + nm + '_n', e.n, 0); put('w_' + nm + '_miss', 100 * e.miss, 1); put('w_' + nm + '_vs', 100 * e.vs, 1); put('w_' + nm + '_spread', 100 * e.spread, 1); put('w_' + nm + '_close', e.close, 0); put('w_' + nm + '_closemiss', 100 * e.closeMiss, 0);
    if (e.iou !== null) put('w_' + nm + '_iou', 100 * e.iou, 0);
  });
  // the widget's named rules equal the engine's rules and the table: (r, k) = (0, 1) is 'any pixel', (0.15, 6) the exam, (0.5, 1) half, (0.65, 1) reasonable
  check(F.w_A_exam_n === F.n_exam && F.w_A_pixel_n === F.n_pixel && F.w_A_half_n === F.n_half && F.w_A_amodal_read_n === F.n_amodal, 'the widget\'s cut and area box reproduce the named rules');
  check(F.w_R_exam_n === F.nR_exam && F.w_R_pixel_n === F.nR_pixel && F.w_R_half_n === F.nR_half && F.w_R_reason_n === F.nR_reason, 'the widget reproduces the rare slice\'s counts');
  check(Math.abs(F.w_A_exam_miss - F.w_exam_seed1) < 0.051, 'the widget\'s exam miss is the seed-1 exam');
  check(page.problems.length === 0, 'the widget survives the states the prose names: ' + page.problems.slice(0, 2).join(' | '));
  put('w_spread_gap', F.w_R_pixel_miss - F.w_R_half_miss, 1);
}

if (bad) { console.error(bad + ' check(s) failed'); process.exit(1); }
log('done');
console.log(JSON.stringify({ facts: F }));
